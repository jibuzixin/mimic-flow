import logging
import math
import os
import subprocess
import tempfile
import time
import uuid
import wave
from pathlib import Path

import httpx

from provider import ZhipuAI


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


ZHIPU_API_KEY = ""
VISION_MODEL = "glm-4.6v"
ASR_MODEL = "glm-asr-2512"
ASR_URL = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions"


def get_wav_duration(audio_path: str) -> float:
    with wave.open(audio_path, "rb") as wav_file:
        frames = wav_file.getnframes()
        rate = wav_file.getframerate()
    return frames / rate


def cut_audio_chunk(audio_path: str, start_time: float, duration: float, output_path: str) -> None:
    logger.info(
        "🎙️ [GLM-ASR] cut chunk | start=%.2fs | duration=%.2fs | output=%s",
        start_time,
        duration,
        output_path,
    )
    command = [
        "ffmpeg",
        "-y",
        "-i",
        audio_path,
        "-ss",
        str(start_time),
        "-t",
        str(duration),
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        output_path,
    ]
    subprocess.run(command, check=True, capture_output=True)


def transcribe_with_glm_asr(audio_path: str) -> dict:
    total_duration = get_wav_duration(audio_path)
    chunk_seconds = 25
    segments = []
    started_at = time.perf_counter()
    logger.info(
        "🎙️ [GLM-ASR] start transcription | audio_path=%s | duration=%.2fs | chunk_seconds=%s",
        audio_path,
        total_duration,
        chunk_seconds,
    )

    with tempfile.TemporaryDirectory(prefix="glm-asr-chunks-") as temp_dir:
        chunk_dir = Path(temp_dir)
        with httpx.Client(timeout=120) as client:
            total_chunks = math.ceil(total_duration / chunk_seconds)
            logger.info("🎙️ [GLM-ASR] total chunks=%s", total_chunks)

            for index in range(total_chunks):
                start_time = index * chunk_seconds
                duration = min(chunk_seconds, total_duration - start_time)
                chunk_path = chunk_dir / f"chunk_{index:04d}.wav"

                cut_audio_chunk(
                    audio_path=audio_path,
                    start_time=start_time,
                    duration=duration,
                    output_path=str(chunk_path),
                )

                chunk_started_at = time.perf_counter()
                with open(chunk_path, "rb") as audio_file:
                    response = client.post(
                        ASR_URL,
                        headers={"Authorization": f"Bearer {ZHIPU_API_KEY}"},
                        data={
                            "model": ASR_MODEL,
                            "stream": "false",
                            "request_id": str(uuid.uuid4()),
                        },
                        files={
                            "file": (chunk_path.name, audio_file, "audio/wav"),
                        },
                    )

                response.raise_for_status()
                data = response.json()
                text = data.get("text", "").strip()
                logger.info(
                    "🎙️ [GLM-ASR] chunk done | index=%s/%s | elapsed=%.2fs | text=%s",
                    index + 1,
                    total_chunks,
                    time.perf_counter() - chunk_started_at,
                    text[:120] if text else "<empty>",
                )
                if not text:
                    continue

                segments.append(
                    {
                        "start": start_time,
                        "end": start_time + duration,
                        "text": text,
                    }
                )

    logger.info(
        "🎙️ [GLM-ASR] transcription done | segments=%s | elapsed=%.2fs",
        len(segments),
        time.perf_counter() - started_at,
    )
    return {"segments": segments}


def main() -> None:
    video_path = '/Users/yzy/Desktop/录屏2026-07-14 19.04.53.mov'

    from prompts.planner import PLANNER_PROMPT

    client = ZhipuAI(api_key=ZHIPU_API_KEY)

    started_at = time.perf_counter()
    result = client.chat_with_video(
        prompt=PLANNER_PROMPT,
        video_path=video_path,
        model=VISION_MODEL,
        audio_model=transcribe_with_glm_asr,
        extract_audio=True,
        use_parallel=False,
        max_concurrency=3,
        batch_max_frames=10,
        retry_times=3,
        segment_duration=60,
        min_segment_duration=20,
    )

    logger.info("🎬 [Demo] total elapsed=%.2fs", time.perf_counter() - started_at)

    print("\n===== 最终汇总 =====\n")
    print(result["summary"])

    print("\n===== 元数据 =====\n")
    print(result["metadata"])

    print("\n===== 分段结果 =====\n")
    for batch in result["batch_results"]:
        print(
            f"[batch={batch['batch_index']}] "
            f"{batch['time_range']['start_text']} - {batch['time_range']['end_text']} "
            f"frames={batch['frame_count']}"
        )
        print(batch["response"])
        print("-" * 80)


if __name__ == "__main__":
    main()
