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
    segments: list[VideoSegment]


class VideoProcessor:
    def prepare_analysis_material(
        self,
        video_path: str,
        work_dir: str,
        batch_max_frames: int = 10,
        segment_duration: int = 60,
        min_segment_duration: int = 20,
        static_interval: int = 8,
        motion_interval: int = 2,
        static_threshold: float = 8.0,
        scene_threshold: float = 18.0,
    ) -> VideoAnalysisMaterial:
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
        actual_segment_duration = max(min_segment_duration, min(segment_duration, int(duration) or segment_duration))
        segment_count = max(1, int(np.ceil(duration / actual_segment_duration)))

        logger.info(
            "准备视频分析素材 | duration=%.2fs | fps=%.2f | segments=%d",
            duration,
            fps,
            segment_count,
        )

        segment_candidates: list[list[FrameCandidate]] = [[] for _ in range(segment_count)]
        last_saved_at: list[Optional[float]] = [None for _ in range(segment_count)]
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
            if frame_index == 0 or frame_index == total_frames - 1:
                save_reason = True
            elif score >= scene_threshold:
                save_reason = last_saved is None or timestamp - last_saved >= motion_interval
            elif score <= static_threshold:
                save_reason = last_saved is None or timestamp - last_saved >= static_interval
            else:
                middle_interval = max(motion_interval, (motion_interval + static_interval) / 2)
                save_reason = last_saved is None or timestamp - last_saved >= middle_interval

            if save_reason:
                frame_path = frames_dir / f"segment_{segment_index:03d}_{timestamp:08.2f}s.jpg"
                cv2.imwrite(str(frame_path), frame)
                segment_candidates[segment_index].append(
                    FrameCandidate(timestamp=timestamp, path=str(frame_path), score=score)
                )
                last_saved_at[segment_index] = timestamp

            previous_frame = frame
            frame_index += 1

        capture.release()

        segments: list[VideoSegment] = []
        for index in range(segment_count):
            start_time = index * actual_segment_duration
            end_time = min(duration, (index + 1) * actual_segment_duration)
            candidates = segment_candidates[index]
            if len(candidates) < batch_max_frames:
                selected = self._supplement_frames(
                    existing_candidates=candidates,
                    video_path=str(video_file),
                    frames_dir=frames_dir,
                    segment_index=index,
                    start_time=start_time,
                    end_time=end_time,
                    frame_count=batch_max_frames,
                )
            else:
                selected = self._select_segment_frames(
                    candidates=candidates,
                    batch_max_frames=batch_max_frames,
                    segment_start=start_time,
                    segment_end=end_time,
                )
            segments.append(
                VideoSegment(
                    index=index,
                    start_time=start_time,
                    end_time=end_time,
                    frame_candidates=selected,
                )
            )

        audio_path = self.extract_audio(video_path=video_path, output_dir=str(work_path))

        return VideoAnalysisMaterial(
            video_path=str(video_file),
            duration=duration,
            fps=fps,
            audio_path=audio_path,
            segments=segments,
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

    def _select_segment_frames(
        self,
        candidates: list[FrameCandidate],
        batch_max_frames: int,
        segment_start: float,
        segment_end: float,
    ) -> list[FrameCandidate]:
        if not candidates:
            return []

        if len(candidates) <= batch_max_frames:
            return candidates

        selected_positions = {
            0,
            len(candidates) - 1,
            max(range(len(candidates)), key=lambda idx: candidates[idx].score),
        }

        while len(selected_positions) < batch_max_frames:
            target_ratio = len(selected_positions) / max(batch_max_frames - 1, 1)
            target_time = segment_start + (segment_end - segment_start) * target_ratio
            best_index = min(
                range(len(candidates)),
                key=lambda idx: (
                    idx in selected_positions,
                    abs(candidates[idx].timestamp - target_time),
                    -candidates[idx].score,
                ),
            )
            selected_positions.add(best_index)

        return [candidates[index] for index in sorted(selected_positions, key=lambda idx: candidates[idx].timestamp)]

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
        capture = cv2.VideoCapture(video_path)
        if not capture.isOpened():
            return existing_candidates

        fps = capture.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            capture.release()
            return existing_candidates

        duration = max(end_time - start_time, 0.0)
        if duration <= 0:
            capture.release()
            return existing_candidates

        merged: dict[int, FrameCandidate] = {
            int(candidate.timestamp * 100): candidate for candidate in existing_candidates
        }
        timestamps = [
            start_time + duration * (index / max(frame_count - 1, 1))
            for index in range(frame_count)
        ]

        for timestamp in timestamps:
            if len(merged) >= frame_count:
                break
            rounded = int(timestamp * 100)
            if rounded in merged:
                continue
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ok, frame = capture.read()
            if not ok:
                continue
            frame_path = frames_dir / f"segment_{segment_index:03d}_{timestamp:08.2f}s_uniform.jpg"
            cv2.imwrite(str(frame_path), frame)
            merged[rounded] = FrameCandidate(timestamp=timestamp, path=str(frame_path), score=0.0)

        capture.release()
        return [merged[key] for key in sorted(merged)]

    def _frame_difference(self, frame1: np.ndarray, frame2: np.ndarray) -> float:
        gray1 = cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(gray1, gray2)
        return float(diff.mean() / 255.0 * 100.0)
