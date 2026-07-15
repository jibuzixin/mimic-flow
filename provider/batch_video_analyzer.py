from __future__ import annotations

import inspect
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Callable, Optional

from processor import TranscriptSegment, VideoProcessor, transcribe_audio

logger = logging.getLogger(__name__)

MultimodalModel = Callable[..., str]
AudioModel = Callable[[str], Any]


@dataclass(frozen=True)
class BatchResult:
    batch_index: int
    start_time: float
    end_time: float
    frame_paths: list[str]
    frame_timestamps: list[float]
    transcript: str
    response: str


class BatchVideoAnalyzer:
    def __init__(
        self,
        multimodal_model: MultimodalModel,
        audio_model: Optional[AudioModel] = None,
        extract_audio: bool = True,
        segment_duration: int = 60,
        min_segment_duration: int = 20,
    ):
        self.multimodal_model = multimodal_model
        self.audio_model = audio_model
        self.extract_audio = extract_audio
        self.segment_duration = segment_duration
        self.min_segment_duration = min_segment_duration
        self.video_processor = VideoProcessor()

    @classmethod
    def from_callables(
        cls,
        multimodal_model: MultimodalModel,
        audio_model: Optional[AudioModel] = None,
        extract_audio: bool = True,
        segment_duration: int = 60,
        min_segment_duration: int = 20,
    ) -> "BatchVideoAnalyzer":
        return cls(
            multimodal_model=multimodal_model,
            audio_model=audio_model,
            extract_audio=extract_audio,
            segment_duration=segment_duration,
            min_segment_duration=min_segment_duration,
        )

    def analyze(
        self,
        video_path: str,
        prompt: str,
        use_parallel: bool = False,
        max_concurrency: int = 3,
        batch_max_frames: int = 10,
        retry_times: int = 3,
    ) -> dict[str, Any]:
        """编排视频抽帧、音频转写和多模态批处理。

        Args:
            video_path: 本地视频路径。
            prompt: 传给每个视频批次的用户需求。
            use_parallel: 是否并行执行多个批次。
            max_concurrency: 并行模式下最多同时执行的批次数。
            batch_max_frames: 单个批次最多包含的图片数；这是限制单次模型请求图片数量的核心参数。
            retry_times: 单个批次失败后的最大重试次数；当前实现最多实际尝试 2 次。

        Returns:
            包含 summary、batch_results、metadata 的结果字典。
        """
        total_started_at = time.perf_counter()
        work_dir = self.video_processor.create_work_dir()
        parallel_workers = max(1, max_concurrency)
        logger.info(
            "📦 [VideoBatch] analyze start | video=%s | parallel=%s | workers=%s | batch_max_frames=%s | retry_times=%s",
            video_path,
            use_parallel,
            parallel_workers if use_parallel else 1,
            batch_max_frames,
            retry_times,
        )
        try:
            prepare_started_at = time.perf_counter()
            material = self.video_processor.prepare_analysis_material(
                video_path=video_path,
                work_dir=work_dir,
                batch_max_frames=batch_max_frames,
                extract_audio=self.extract_audio,
                segment_duration=self.segment_duration,
                min_segment_duration=self.min_segment_duration,
            )
            logger.info(
                "📦 [VideoBatch] material ready | segments=%s | duration=%.2fs | prepare_elapsed=%.2fs",
                len(material.segments),
                material.duration,
                time.perf_counter() - prepare_started_at,
            )

            asr_started_at = time.perf_counter()
            transcript_segments = transcribe_audio(
                audio_model=self.audio_model,
                audio_path=material.audio_path,
                duration=material.duration,
            )
            logger.info(
                "🎙️ [VideoBatch] transcript ready | segments=%s | elapsed=%.2fs",
                len(transcript_segments),
                time.perf_counter() - asr_started_at,
            )
            batch_payloads = self._build_batch_payloads(
                material=material,
                transcript_segments=transcript_segments,
                prompt=prompt,
            )
            logger.info("📦 [VideoBatch] payloads ready | total_batches=%s", len(batch_payloads))
            if use_parallel and len(batch_payloads) > 1:
                batch_results = self._run_parallel(
                    batch_payloads=batch_payloads,
                    max_concurrency=parallel_workers,
                    retry_times=retry_times,
                )
            else:
                batch_results = self._run_serial(
                    batch_payloads=batch_payloads,
                    retry_times=retry_times,
                )

            final_summary = "\n".join(result.response for result in batch_results)
            metadata = {
                "video_path": material.video_path,
                "duration": material.duration,
                "fps": material.fps,
                "total_batches": len(batch_results),
                "use_parallel": use_parallel,
                "max_concurrency": parallel_workers if use_parallel else 1,
                "batch_max_frames": batch_max_frames,
                "extract_audio": self.extract_audio,
                "has_audio_track": material.has_audio_track,
                "frame_sampling_mode": material.sampling_mode,
                "audio_used": bool(transcript_segments),
                "audio_segments": len(transcript_segments),
                "segment_duration": self.segment_duration,
                "total_elapsed": round(time.perf_counter() - total_started_at, 2),
            }
            logger.info(
                "📦 [VideoBatch] analyze done | total_batches=%s | elapsed=%.2fs",
                len(batch_results),
                time.perf_counter() - total_started_at,
            )
            return {
                "summary": final_summary,
                "batch_results": [self._serialize_batch_result(result) for result in batch_results],
                "metadata": metadata,
            }
        finally:
            self.video_processor.cleanup_work_dir(work_dir)

    def _build_batch_payloads(
        self,
        material,
        transcript_segments: list[TranscriptSegment],
        prompt: str,
    ) -> list[dict[str, Any]]:
        payloads: list[dict[str, Any]] = []
        total_batches = len(material.segments)

        for segment in material.segments:
            frame_paths = [candidate.path for candidate in segment.frame_candidates]
            frame_timestamps = [candidate.timestamp for candidate in segment.frame_candidates]
            transcript = self._join_transcript(
                transcript_segments=transcript_segments,
                start_time=segment.start_time,
                end_time=segment.end_time,
            )
            logger.info(
                "📦 [VideoBatch] build payload | batch=%s/%s | frames=%s | transcript_chars=%s | range=%s-%s | span=%.2fs",
                segment.index + 1,
                total_batches,
                len(frame_paths),
                len(transcript),
                self._format_seconds(segment.start_time),
                self._format_seconds(segment.end_time),
                max(segment.end_time - segment.start_time, 0.0),
            )
            payloads.append(
                {
                    "batch_index": segment.index + 1,
                    "total_batches": total_batches,
                    "prompt": self._build_prompt(
                        prompt=prompt,
                        start_time=segment.start_time,
                        end_time=segment.end_time,
                        frame_timestamps=frame_timestamps,
                        transcript=transcript,
                    ),
                    "image_paths": frame_paths,
                    "frame_timestamps": frame_timestamps,
                    "start_time": segment.start_time,
                    "end_time": segment.end_time,
                    "transcript": transcript,
                }
            )

        return payloads

    def _run_serial(
        self,
        batch_payloads: list[dict[str, Any]],
        retry_times: int,
    ) -> list[BatchResult]:
        logger.info("📦 [VideoBatch] run serial | batches=%s", len(batch_payloads))
        return [self._run_single_batch(payload, retry_times) for payload in batch_payloads]

    def _run_parallel(
        self,
        batch_payloads: list[dict[str, Any]],
        max_concurrency: int,
        retry_times: int,
    ) -> list[BatchResult]:
        logger.info(
            "📦 [VideoBatch] run parallel | batches=%s | workers=%s",
            len(batch_payloads),
            max_concurrency,
        )
        results: list[Optional[BatchResult]] = [None] * len(batch_payloads)
        with ThreadPoolExecutor(max_workers=max(1, max_concurrency)) as executor:
            future_map = {
                executor.submit(self._run_single_batch, payload, retry_times): index
                for index, payload in enumerate(batch_payloads)
            }
            for future in as_completed(future_map):
                index = future_map[future]
                results[index] = future.result()
        return [result for result in results if result is not None]

    def _run_single_batch(
        self,
        payload: dict[str, Any],
        retry_times: int,
    ) -> BatchResult:
        last_error: Optional[Exception] = None
        max_attempts = max(1, min(retry_times, 2))
        for attempt in range(max_attempts):
            try:
                batch_started_at = time.perf_counter()
                logger.info(
                    "📦 [VideoBatch] batch start | batch=%s/%s | attempt=%s/%s | frames=%s",
                    payload["batch_index"],
                    payload["total_batches"],
                    attempt + 1,
                    max_attempts,
                    len(payload["image_paths"]),
                )
                response, finish_reason = self._invoke_multimodal_model(payload)
                elapsed = time.perf_counter() - batch_started_at
                logger.info(
                    "📦 [VideoBatch] batch done | batch=%s/%s | attempt=%s/%s | finish_reason=%s | elapsed=%.2fs",
                    payload["batch_index"],
                    payload["total_batches"],
                    attempt + 1,
                    max_attempts,
                    finish_reason,
                    elapsed,
                )
                if finish_reason == "length" and attempt < max_attempts - 1:
                    logger.warning(
                        "📦 [VideoBatch] batch retry for finish_reason=length | batch=%s/%s",
                        payload["batch_index"],
                        payload["total_batches"],
                    )
                    continue
                return BatchResult(
                    batch_index=payload["batch_index"],
                    start_time=payload["start_time"],
                    end_time=payload["end_time"],
                    frame_paths=payload["image_paths"],
                    frame_timestamps=payload["frame_timestamps"],
                    transcript=payload["transcript"],
                    response=str(response).strip(),
                )
            except Exception as exc:
                last_error = exc
                if attempt < max_attempts - 1:
                    wait_seconds = 1
                    logger.warning(
                        "📦 [VideoBatch] batch failed, retrying | batch=%s/%s | attempt=%s/%s | error=%s",
                        payload["batch_index"],
                        payload["total_batches"],
                        attempt + 1,
                        max_attempts,
                        exc,
                    )
                    time.sleep(wait_seconds)
        raise RuntimeError(f"批次 {payload['batch_index']} 分析失败: {last_error}") from last_error

    def _invoke_multimodal_model(self, payload: dict[str, Any]) -> tuple[str, str]:
        signature = inspect.signature(self.multimodal_model)
        parameters = signature.parameters.values()
        if any(parameter.kind == inspect.Parameter.VAR_KEYWORD for parameter in parameters):
            result = self.multimodal_model(**payload)
        else:
            accepted_names = {
                parameter.name
                for parameter in parameters
                if parameter.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)
            }
            if accepted_names:
                result = self.multimodal_model(**{key: value for key, value in payload.items() if key in accepted_names})
            else:
                result = self.multimodal_model(payload)

        if isinstance(result, tuple) and len(result) == 2:
            response, finish_reason = result
            return str(response), str(finish_reason)
        return str(result), "stop"

    def _join_transcript(
        self,
        transcript_segments: list[TranscriptSegment],
        start_time: float,
        end_time: float,
    ) -> str:
        matched = [
            f"[{self._format_seconds(segment.start_time)}-{self._format_seconds(segment.end_time)}] {segment.text}"
            for segment in transcript_segments
            if not (segment.end_time < start_time or segment.start_time > end_time)
        ]
        return "\n".join(matched)

    def _build_prompt(
        self,
        prompt: str,
        start_time: float,
        end_time: float,
        frame_timestamps: list[float],
        transcript: str,
    ) -> str:
        frame_lines = "\n".join(
            f"- 第{index + 1}帧: {self._format_seconds(timestamp)}"
            for index, timestamp in enumerate(frame_timestamps)
        )
        transcript_text = transcript or "无音频或未提供音频转写。"
        return (
            f"请只分析这个时间段内的信息，不要推测其他时间段。\n"
            f"时间区间: {self._format_seconds(start_time)} - {self._format_seconds(end_time)}\n"
            f"当前批次帧时间戳:\n{frame_lines}\n\n"
            f"对应音频转写:\n{transcript_text}\n\n"
            f"用户需求:\n{prompt}"
        )

    def _serialize_batch_result(self, result: BatchResult) -> dict[str, Any]:
        return {
            "batch_index": result.batch_index,
            "time_range": {
                "start": result.start_time,
                "end": result.end_time,
                "start_text": self._format_seconds(result.start_time),
                "end_text": self._format_seconds(result.end_time),
            },
            "frame_count": len(result.frame_paths),
            "frame_paths": result.frame_paths,
            "frame_timestamps": result.frame_timestamps,
            "transcript": result.transcript,
            "response": result.response,
        }

    def _format_seconds(self, seconds: float) -> str:
        total = max(0, int(seconds))
        hours = total // 3600
        minutes = (total % 3600) // 60
        secs = total % 60
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
