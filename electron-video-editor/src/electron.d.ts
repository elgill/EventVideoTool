export interface ElectronAPI {
  // Dialog methods
  selectDirectory: (title?: string) => Promise<string | null>;
  selectFile: (title?: string, filters?: any[]) => Promise<string | null>;

  // Video processing methods
  getFilesFromDirectory: (directoryPath: string) => Promise<VideoFile[]>;
  concatenateVideos: (options: ConcatenateOptions) => Promise<{ success: boolean; outputPath: string }>;
  processVideo: (options: ProcessOptions) => Promise<{ success: boolean; outputPath: string }>;
  getVideoMetadata: (filePath: string) => Promise<VideoMetadata>;

  // File operations
  fileExists: (filePath: string) => Promise<boolean>;
  openExternal: (filePath: string) => Promise<boolean>;

  // Progress listener
  onProgress: (callback: (data: ProgressData) => void) => () => void;
}

export interface VideoFile {
  path: string;
  name: string;
  duration: number;
  size: number;
}

export interface ConcatenateOptions {
  inputFiles: string[];
  outputPath: string;
  useHardwareAcceleration: boolean;
}

export interface ProcessOptions {
  inputPath: string;
  outputPath: string;
  startTime?: string;
  endTime?: string;
  reEncode: boolean;
  mute: boolean;
  useHardwareAcceleration: boolean;
  bitrate?: string;
}

export interface VideoMetadata {
  duration: number;
  size: number;
  bitrate: number;
  format: string;
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  fps: number;
}

export interface ProgressData {
  operation: 'concatenate' | 'process';
  status: 'started' | 'processing' | 'completed' | 'error';
  percent?: number;
  currentFps?: number;
  targetSize?: number;
  timemark?: string;
  error?: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
