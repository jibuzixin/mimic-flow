from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Callable, Optional

import logging


logger = logging.getLogger(__name__)
@dataclass
class TranscriptSegment:
    start_time: float
    end_time: float
    text: str


AudioModel = Callable[[str], Any]


def transcribe_audio(
    audio_model: Optional[AudioModel],
    audio_path: Optional[str],
    duration: float,
) -> list[TranscriptSegment]:
    if audio_model is None or not audio_path:
        logger.info("🎙️ [Transcriber] skip audio transcription | audio_model=%s | audio_path=%s", bool(audio_model), audio_path)
        return []

    logger.info("🎙️ [Transcriber] start transcription | audio_path=%s | duration=%.2fs", audio_path, duration)
    result = audio_model(audio_path)
    normalized = normalize_transcript(result, duration)
    preview = " | ".join(segment.text for segment in normalized[:3])
    logger.info(
        "🎙️ [Transcriber] transcription done | segments=%s | preview=%s",
        len(normalized),
        preview or "<empty>",
    )
    return normalized


def normalize_transcript(result: Any, duration: float) -> list[TranscriptSegment]:
    if result is None:
        return []

    if isinstance(result, str):
        text = result.strip()
        if not text:
            return []
        return [TranscriptSegment(start_time=0.0, end_time=max(duration, 0.0), text=text)]

    if isinstance(result, dict):
        if "segments" in result:
            return _normalize_segments(result["segments"], duration)
        if "text" in result:
            return normalize_transcript(result["text"], duration)
        raise TypeError("音频模型返回的 dict 缺少 text 或 segments 字段")

    if isinstance(result, Iterable) and not isinstance(result, (bytes, bytearray)):
        return _normalize_segments(result, duration)

    raise TypeError("音频模型返回值必须是 str、dict 或可迭代分段结果")


def _normalize_segments(raw_segments: Iterable[Any], duration: float) -> list[TranscriptSegment]:
    normalized: list[dict[str, Any]] = []

    for raw in raw_segments:
        if isinstance(raw, TranscriptSegment):
            normalized.append(
                {
                    "start": raw.start_time,
                    "end": raw.end_time,
                    "text": raw.text,
                }
            )
            continue

        if not isinstance(raw, dict):
            raise TypeError("音频分段必须是 dict 或 TranscriptSegment")

        normalized.append(raw)

    segments: list[TranscriptSegment] = []

    for index, raw in enumerate(normalized):
        text = str(raw.get("text", "")).strip()
        if not text:
            continue

        start = _to_float(raw.get("start_time", raw.get("start", 0.0)))
        explicit_end = raw.get("end_time", raw.get("end"))

        if explicit_end is None:
            if index + 1 < len(normalized):
                end = _to_float(
                    normalized[index + 1].get(
                        "start_time",
                        normalized[index + 1].get("start", start),
                    )
                )
            else:
                end = duration
        else:
            end = _to_float(explicit_end)

        start = max(start, 0.0)
        end = max(end, start)
        if duration > 0:
            end = min(end, duration)

        segments.append(TranscriptSegment(start_time=start, end_time=end, text=text))

    segments.sort(key=lambda item: item.start_time)
    return segments


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise TypeError(f"无法将时间字段转换为 float: {value!r}") from exc
