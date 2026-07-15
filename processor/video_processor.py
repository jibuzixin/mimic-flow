from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)
SHORT_BATCH_THRESHOLD_SECONDS = 1.5
TAIL_COVERAGE_WINDOW_SECONDS = 1.5


@dataclass(frozen=True)
class FrameCandidate:
    timestamp: float
    path: str
    score: float


@dataclass(frozen=True)
class VideoSegment:
    index: int
    start_time: float
    end_time: float
    frame_candidates: list[FrameCandidate]


@dataclass(frozen=True)
class VideoAnalysisMaterial:
    video_path: str
    duration: float
    fps: float
    audio_path: Optional[str]
    sampling_mode: str
    has_audio_track: bool
    segments: list[VideoSegment]


class VideoProcessor:
    def prepare_analysis_material(
        self,
        video_path: str,
        work_dir: str,
        batch_max_frames: int = 10,
        extract_audio: bool = True,
        segment_duration: int = 60,
        min_segment_duration: int = 20,
        static_interval: int = 8,
        motion_interval: int = 2,
        static_threshold: float = 8.0,
        scene_threshold: float = 18.0,
    ) -> VideoAnalysisMaterial:
        """准备视频分析所需的抽帧结果和音频素材。

        Args:
            video_path: 本地视频文件路径。
            work_dir: 临时工作目录，用于保存抽出的帧和音频。
            batch_max_frames: 单个请求批次允许的最大图片数；如果候选帧总数超过该值，会切成多个带重叠的请求批次，不代表整段视频最终只保留这么多张图。
            extract_audio: 是否提取视频音频；为 False 时即使有音轨也按无音频处理。
            segment_duration: 智能抽帧扫描阶段的时间桶上限，用来控制多久重置一次“上一张已保存帧”的节奏。
            min_segment_duration: 智能抽帧扫描阶段的时间桶下限，避免短视频被切得过碎。
            static_interval: 静态画面最小抽帧间隔，单位秒。
            motion_interval: 明显变化画面的最小抽帧间隔，单位秒。
            static_threshold: 判定为静态画面的帧差阈值。
            scene_threshold: 判定为明显变化或转场的帧差阈值。

        Returns:
            包含视频时长、帧率、抽帧批次和可选音频路径的素材对象。
        """
        if batch_max_frames <= 0:
            raise ValueError("batch_max_frames 必须大于 0")
        if segment_duration <= 0:
            raise ValueError("segment_duration 必须大于 0")
        if min_segment_duration <= 0:
            raise ValueError("min_segment_duration 必须大于 0")
        if static_interval <= 0 or motion_interval <= 0:
            raise ValueError("抽帧间隔必须大于 0")
        if motion_interval > static_interval:
            raise ValueError("motion_interval 不能大于 static_interval")

        video_file = Path(video_path)
        if not video_file.exists():
            raise FileNotFoundError(f"视频文件不存在: {video_path}")

        work_path = Path(work_dir)
        frames_dir = work_path / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        capture = cv2.VideoCapture(str(video_file))
        if not capture.isOpened():
            raise ValueError(f"无法打开视频文件: {video_path}")

        fps = capture.get(cv2.CAP_PROP_FPS)
        total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if not fps or fps <= 0 or total_frames <= 0:
            capture.release()
            raise ValueError(f"无法读取视频元数据: {video_path}")

        duration = total_frames / fps
        actual_segment_duration = max(min_segment_duration, min(segment_duration, duration))
        segment_count = max(1, int(np.ceil(duration / actual_segment_duration)))

        logger.info(
            "准备视频分析素材 | duration=%.2fs | fps=%.2f | scan_segments=%d | static_interval=%ss | motion_interval=%ss | static_threshold=%.2f | scene_threshold=%.2f",
            duration,
            fps,
            segment_count,
            static_interval,
            motion_interval,
            static_threshold,
            scene_threshold,
        )

        audio_path = self.extract_audio(video_path=video_path, output_dir=str(work_path)) if extract_audio else None
        has_audio_track = audio_path is not None
        sampling_mode = "smart" if has_audio_track else "uniform"
        logger.info(
            "抽帧模式 | extract_audio=%s | has_audio_track=%s | sampling_mode=%s",
            extract_audio,
            has_audio_track,
            sampling_mode,
        )

        if sampling_mode == "smart":
            all_candidates = self._collect_smart_candidates(
                video_path=str(video_file),
                frames_dir=frames_dir,
                fps=fps,
                total_frames=total_frames,
                segment_count=segment_count,
                actual_segment_duration=actual_segment_duration,
                static_interval=static_interval,
                motion_interval=motion_interval,
                static_threshold=static_threshold,
                scene_threshold=scene_threshold,
            )
        else:
            all_candidates = self._collect_uniform_candidates(
                video_path=str(video_file),
                frames_dir=frames_dir,
                batch_max_frames=batch_max_frames,
                duration=duration,
                segment_count=segment_count,
            )

        selected_candidates = self._select_global_batches(
            candidates=all_candidates,
            video_path=str(video_file),
            frames_dir=frames_dir,
            batch_max_frames=batch_max_frames,
            video_duration=duration,
        )

        segments: list[VideoSegment] = []
        for index, batch_candidates in enumerate(selected_candidates):
            if not batch_candidates:
                continue
            start_time = batch_candidates[0].timestamp
            end_time = batch_candidates[-1].timestamp
            if end_time - start_time < SHORT_BATCH_THRESHOLD_SECONDS and len(selected_candidates) > 1:
                logger.info(
                    "跳过过短批次 | batch=%s | duration=%.2fs | threshold=%.2fs | frames=%s | timestamps=%s",
                    index + 1,
                    end_time - start_time,
                    SHORT_BATCH_THRESHOLD_SECONDS,
                    len(batch_candidates),
                    [round(candidate.timestamp, 2) for candidate in batch_candidates],
                )
                continue
            logger.info(
                "批次保留 | batch=%s | range=%.2fs-%.2fs | duration=%.2fs | frames=%s | timestamps=%s",
                len(segments) + 1,
                start_time,
                end_time,
                end_time - start_time,
                len(batch_candidates),
                [round(candidate.timestamp, 2) for candidate in batch_candidates],
            )
            segments.append(
                VideoSegment(
                    index=len(segments),
                    start_time=start_time,
                    end_time=end_time,
                    frame_candidates=batch_candidates,
                )
            )

        logger.info(
            "准备视频分析素材完成 | source_frames=%s | request_batches=%s | overlap_frames=%s | short_batch_threshold=%.2fs | tail_window=%.2fs | sampling_mode=%s | has_audio_track=%s",
            len(all_candidates),
            len(segments),
            min(2, max(0, batch_max_frames - 1)),
            SHORT_BATCH_THRESHOLD_SECONDS,
            TAIL_COVERAGE_WINDOW_SECONDS,
            sampling_mode,
            has_audio_track,
        )

        return VideoAnalysisMaterial(
            video_path=str(video_file),
            duration=duration,
            fps=fps,
            audio_path=audio_path,
            sampling_mode=sampling_mode,
            has_audio_track=has_audio_track,
            segments=segments,
        )

    def _collect_smart_candidates(
        self,
        video_path: str,
        frames_dir: Path,
        fps: float,
        total_frames: int,
        segment_count: int,
        actual_segment_duration: float,
        static_interval: int,
        motion_interval: int,
        static_threshold: float,
        scene_threshold: float,
    ) -> list[FrameCandidate]:
        capture = cv2.VideoCapture(video_path)
        if not capture.isOpened():
            raise ValueError(f"无法打开视频文件: {video_path}")

        segment_candidates: list[list[FrameCandidate]] = [[] for _ in range(segment_count)]
        last_saved_at: list[Optional[float]] = [None for _ in range(segment_count)]
        all_candidates: list[FrameCandidate] = []
        previous_frame: Optional[np.ndarray] = None
        frame_index = 0

        while True:
            ok, frame = capture.read()
            if not ok:
                break

            timestamp = frame_index / fps
            segment_index = min(segment_count - 1, int(timestamp / actual_segment_duration))
            score = 100.0 if previous_frame is None else self._frame_difference(previous_frame, frame)
            last_saved = last_saved_at[segment_index]

            save_reason = False
            reason = ""
            rule_interval: Optional[float] = None
            if frame_index == 0:
                save_reason = True
                reason = "first_frame"
            elif frame_index == total_frames - 1:
                save_reason = True
                reason = "last_frame"
            elif score >= scene_threshold:
                rule_interval = motion_interval
                save_reason = last_saved is None or timestamp - last_saved >= motion_interval
                reason = "scene_change"
            elif score <= static_threshold:
                rule_interval = static_interval
                save_reason = last_saved is None or timestamp - last_saved >= static_interval
                reason = "static_interval"
            else:
                middle_interval = max(motion_interval, (motion_interval + static_interval) / 2)
                rule_interval = middle_interval
                save_reason = last_saved is None or timestamp - last_saved >= middle_interval
                reason = "middle_interval"

            if save_reason:
                frame_path = frames_dir / f"segment_{segment_index:03d}_{timestamp:08.2f}s.jpg"
                cv2.imwrite(str(frame_path), frame)
                candidate = FrameCandidate(timestamp=timestamp, path=str(frame_path), score=score)
                segment_candidates[segment_index].append(candidate)
                all_candidates.append(candidate)
                last_saved_at[segment_index] = timestamp
                logger.info(
                    "抽帧命中 | ts=%.2fs | segment=%s | score=%.2f | reason=%s | last_saved=%s | min_interval=%s | path=%s",
                    timestamp,
                    segment_index,
                    score,
                    reason,
                    "-" if last_saved is None else f"{last_saved:.2f}s",
                    "-" if rule_interval is None else f"{rule_interval:.2f}s",
                    frame_path.name,
                )

            previous_frame = frame
            frame_index += 1

        capture.release()
        return all_candidates

    def _collect_uniform_candidates(
        self,
        video_path: str,
        frames_dir: Path,
        batch_max_frames: int,
        duration: float,
        segment_count: int,
    ) -> list[FrameCandidate]:
        overlap_frames = min(2, max(0, batch_max_frames - 1))
        step = max(1, batch_max_frames - overlap_frames)
        target_count = batch_max_frames + max(0, segment_count - 1) * step
        logger.info(
            "无音频均匀抽帧 | target_count=%s | batch_max_frames=%s | overlap_frames=%s | step=%s",
            target_count,
            batch_max_frames,
            overlap_frames,
            step,
        )
        return self._extract_uniform_candidates(
            video_path=video_path,
            frames_dir=frames_dir,
            segment_index=0,
            start_time=0.0,
            end_time=duration,
            frame_count=target_count,
        )

    def create_work_dir(self, prefix: str = "video-analysis-") -> str:
        return tempfile.mkdtemp(prefix=prefix)

    def cleanup_work_dir(self, work_dir: str) -> None:
        shutil.rmtree(work_dir, ignore_errors=True)

    def extract_audio(self, video_path: str, output_dir: str) -> Optional[str]:
        audio_path = Path(output_dir) / "audio.wav"
        command = [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(audio_path),
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                check=False,
                timeout=600,
            )
        except FileNotFoundError:
            logger.warning("ffmpeg 不存在，跳过音频提取")
            return None

        if completed.returncode != 0 or not audio_path.exists():
            logger.info("音频提取失败或视频无音轨，跳过音频 | code=%s", completed.returncode)
            return None
        return str(audio_path)

    def _select_global_batches(
        self,
        candidates: list[FrameCandidate],
        video_path: str,
        frames_dir: Path,
        batch_max_frames: int,
        video_duration: float,
    ) -> list[list[FrameCandidate]]:
        if not candidates:
            return []

        total_candidates = len(candidates)
        if total_candidates < batch_max_frames:
            start_time = candidates[0].timestamp
            end_time = max(candidates[-1].timestamp, video_duration)
            logger.info(
                "全局补帧触发 | total_candidates=%s < batch_max_frames=%s | range=%.2fs-%.2fs",
                total_candidates,
                batch_max_frames,
                start_time,
                end_time,
            )
            candidates = self._supplement_frames(
                existing_candidates=candidates,
                video_path=video_path,
                frames_dir=frames_dir,
                segment_index=0,
                start_time=start_time,
                end_time=end_time,
                frame_count=batch_max_frames,
            )
            total_candidates = len(candidates)
            logger.info(
                "全局补帧完成 | frames=%s | timestamps=%s",
                total_candidates,
                [round(candidate.timestamp, 2) for candidate in candidates],
            )

        overlap_frames = min(2, max(0, batch_max_frames - 1))
        step = max(1, batch_max_frames - overlap_frames)
        logger.info(
            "批次切分策略 | total_candidates=%s | batch_max_frames=%s | overlap_frames=%s | step=%s",
            total_candidates,
            batch_max_frames,
            overlap_frames,
            step,
        )
        batches: list[list[FrameCandidate]] = []
        start_index = 0

        while start_index < total_candidates:
            end_index = min(start_index + batch_max_frames, total_candidates)
            batch = candidates[start_index:end_index]
            if not batch:
                break
            logger.info(
                "生成批次 | batch=%s | source_indexes=%s-%s | frames=%s | timestamps=%s",
                len(batches) + 1,
                start_index,
                end_index - 1,
                len(batch),
                [round(candidate.timestamp, 2) for candidate in batch],
            )
            batches.append(batch)
            if end_index >= total_candidates:
                break
            start_index += step

        last_timestamp = candidates[-1].timestamp
        if video_duration - last_timestamp >= TAIL_COVERAGE_WINDOW_SECONDS:
            tail_start = max(last_timestamp, video_duration - TAIL_COVERAGE_WINDOW_SECONDS)
            logger.info(
                "尾部补偿触发 | last_smart_frame=%.2fs | video_duration=%.2fs | tail_start=%.2fs | tail_end=%.2fs",
                last_timestamp,
                video_duration,
                tail_start,
                video_duration,
            )
            tail_candidates = self._extract_uniform_candidates(
                video_path=video_path,
                frames_dir=frames_dir,
                segment_index=len(batches),
                start_time=tail_start,
                end_time=video_duration,
                frame_count=min(batch_max_frames, 3),
            )
            if tail_candidates:
                if batches:
                    overlap_candidates = batches[-1][-overlap_frames:]
                    logger.info(
                        "尾部批次重叠 | overlap_frames=%s | overlap_timestamps=%s | tail_timestamps=%s",
                        len(overlap_candidates),
                        [round(candidate.timestamp, 2) for candidate in overlap_candidates],
                        [round(candidate.timestamp, 2) for candidate in tail_candidates],
                    )
                    tail_candidates = overlap_candidates + tail_candidates
                deduped_tail = self._dedupe_candidates_by_timestamp(tail_candidates)
                if len(deduped_tail) >= 2:
                    logger.info(
                        "尾部批次生成 | frames=%s | timestamps=%s",
                        len(deduped_tail),
                        [round(candidate.timestamp, 2) for candidate in deduped_tail],
                    )
                    batches.append(deduped_tail)

        return batches

    def _supplement_frames(
        self,
        existing_candidates: list[FrameCandidate],
        video_path: str,
        frames_dir: Path,
        segment_index: int,
        start_time: float,
        end_time: float,
        frame_count: int,
    ) -> list[FrameCandidate]:
        if frame_count <= 0:
            return existing_candidates

        supplemented = self._extract_uniform_candidates(
            video_path=video_path,
            frames_dir=frames_dir,
            segment_index=segment_index,
            start_time=start_time,
            end_time=end_time,
            frame_count=frame_count,
        )
        merged = self._dedupe_candidates_by_timestamp(existing_candidates + supplemented)
        logger.info(
            "补帧完成 | segment=%s | existing=%s | supplemented=%s | merged=%s | range=%.2fs-%.2fs | timestamps=%s",
            segment_index,
            len(existing_candidates),
            len(supplemented),
            len(merged),
            start_time,
            end_time,
            [round(candidate.timestamp, 2) for candidate in merged],
        )
        return merged

    def _extract_uniform_candidates(
        self,
        video_path: str,
        frames_dir: Path,
        segment_index: int,
        start_time: float,
        end_time: float,
        frame_count: int,
    ) -> list[FrameCandidate]:
        if frame_count <= 0:
            return []

        capture = cv2.VideoCapture(video_path)
        if not capture.isOpened():
            return []

        fps = capture.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            capture.release()
            return []

        duration = max(end_time - start_time, 0.0)
        if duration <= 0:
            capture.release()
            return []

        timestamps = [
            start_time + duration * (index / max(frame_count - 1, 1))
            for index in range(frame_count)
        ]
        logger.info(
            "均匀抽帧 | segment=%s | range=%.2fs-%.2fs | frame_count=%s | timestamps=%s",
            segment_index,
            start_time,
            end_time,
            frame_count,
            [round(timestamp, 2) for timestamp in timestamps],
        )
        selected: list[FrameCandidate] = []

        for timestamp in timestamps:
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = capture.read()
            if not ok:
                continue
            frame_path = frames_dir / f"segment_{segment_index:03d}_{timestamp:08.2f}s_uniform.jpg"
            cv2.imwrite(str(frame_path), frame)
            selected.append(FrameCandidate(timestamp=timestamp, path=str(frame_path), score=0.0))

        capture.release()
        return selected

    def _dedupe_candidates_by_timestamp(
        self,
        candidates: list[FrameCandidate],
    ) -> list[FrameCandidate]:
        merged: dict[int, FrameCandidate] = {}
        for candidate in candidates:
            merged[int(candidate.timestamp * 100)] = candidate
        return [merged[key] for key in sorted(merged)]

    def _frame_difference(self, frame1: np.ndarray, frame2: np.ndarray) -> float:
        gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(gray1, gray2)
        return float(diff.mean() / 255.0 * 100.0)
