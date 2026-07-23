import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { pathToFileURL } from 'url';
import { dirname, basename, extname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { VideoInfo, FrameExtractionOptions, ExtractedFrames } from './types.js';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function parseRationalFrameRate(rate: string): number {
  if (!rate) return 0;
  const parts = rate.split('/').map((s) => Number(s.trim()));
  if (parts.length === 1) return Number.isFinite(parts[0]) ? parts[0] : 0;
  if (parts.length === 2 && parts[1] !== 0) return parts[0] / parts[1];
  return 0;
}

export function getVideoInfo(path: string): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(path, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      if (!videoStream) {
        reject(new Error('未找到视频流'));
        return;
      }

      const duration = Number(metadata.format.duration ?? 0);
      const width = Number(videoStream.width ?? 0);
      const height = Number(videoStream.height ?? 0);
      const fps = parseRationalFrameRate(videoStream.r_frame_rate ?? '0');
      const bitrate = Number(metadata.format.bit_rate ?? 0);
      const hasAudio = metadata.streams.some((s) => s.codec_type === 'audio');

      resolve({
        path,
        duration,
        width,
        height,
        fps,
        bitrate,
        format: metadata.format.format_name ?? 'unknown',
        hasAudio,
      });
    });
  });
}

export function compressVideo(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .addOption('-crf', '28')
      .addOption('-preset', 'slow')
      .audioCodec('aac')
      .audioBitrate('128k')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

export async function extractFrames(
  videoPath: string,
  options: FrameExtractionOptions
): Promise<ExtractedFrames> {
  if (options.mode === 'native') {
    return { mode: 'native', videoPath };
  }

  const outputDir = join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}_frames`);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const info = await getVideoInfo(videoPath);
  const fps = options.fps ?? 2;
  const maxFrames = options.maxFrames ?? 30;
  const sceneThreshold = options.sceneThreshold ?? 0.3;
  const outputWidth = options.outputWidth ?? 1280;
  const jpegQuality = options.jpegQuality ?? 5;

  const framePattern = join(outputDir, 'frame_%04d.jpg');

  if (options.mode === 'simple') {
    await extractSimpleFrames(videoPath, framePattern, fps, maxFrames, outputWidth, jpegQuality, info);
  } else {
    await extractSmartFrames(videoPath, framePattern, sceneThreshold, maxFrames, outputWidth, jpegQuality, info);
  }

  // Read generated frames sorted
  const { readdirSync } = await import('fs');
  let frames = readdirSync(outputDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(outputDir, f));

  // Enforce maxFrames by uniform sampling when ffmpeg produced too many frames
  if (frames.length > maxFrames) {
    const step = frames.length / maxFrames;
    frames = Array.from({ length: maxFrames }, (_, i) => frames[Math.floor(i * step)]);
  }

  return {
    mode: options.mode,
    framePaths: frames,
    timestamps: frames.map((_, i) => (i / (frames.length || 1)) * info.duration),
  };
}

function extractSimpleFrames(
  videoPath: string,
  framePattern: string,
  fps: number,
  maxFrames: number,
  outputWidth: number,
  jpegQuality: number,
  info: VideoInfo
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Cap total frames by fps and maxFrames
    const duration = Math.max(info.duration, 1);
    const requestedFrames = Math.floor(duration * fps);
    const totalFrames = Math.min(requestedFrames, maxFrames);
    const effectiveFps = totalFrames / duration;

    ffmpeg(videoPath)
      .fps(effectiveFps)
      .size(`${outputWidth}x?`)
      .outputOptions([`-q:v ${jpegQuality}`])
      .output(framePattern)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

function extractSmartFrames(
  videoPath: string,
  framePattern: string,
  sceneThreshold: number,
  maxFrames: number,
  outputWidth: number,
  jpegQuality: number,
  info: VideoInfo
): Promise<void> {
  return new Promise((resolve, reject) => {
    // scene detection filter: keep frames where scene change exceeds threshold.
    // maxFrames is enforced by down-sampling the selected frames via fps filter.
    const duration = Math.max(info.duration, 1);
    const targetFps = maxFrames / duration;

    ffmpeg(videoPath)
      .videoFilters([
        `select='gt(scene,${sceneThreshold})'`,
        `scale=${outputWidth}:-1`,
      ])
      .fps(targetFps)
      .outputOptions([`-q:v ${jpegQuality}`, '-vsync', 'vfr'])
      .output(framePattern)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

export function extractAudio(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

export function fileToBase64(path: string): Promise<string> {
  return import('fs').then(({ readFileSync }) => readFileSync(path).toString('base64'));
}

export function fileToDataUrl(path: string, mimeType = 'image/jpeg'): Promise<string> {
  return fileToBase64(path).then((b64) => `data:${mimeType};base64,${b64}`);
}
