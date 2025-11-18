import { Injectable, signal } from '@angular/core';
import {
  VideoFile,
  VideoMetadata,
  ConcatenateOptions,
  ProcessOptions,
  ProgressData
} from '../../electron';

@Injectable({
  providedIn: 'root',
})
export class VideoService {
  // Signals for reactive state management
  progress = signal<ProgressData | null>(null);
  isProcessing = signal<boolean>(false);
  currentOperation = signal<string>('');

  private electronAPI = (window as any).electronAPI;
  private progressUnsubscribe?: () => void;

  constructor() {
    // Subscribe to progress updates
    if (this.electronAPI) {
      this.progressUnsubscribe = this.electronAPI.onProgress((data: ProgressData) => {
        this.progress.set(data);
        this.isProcessing.set(data.status === 'started' || data.status === 'processing');

        if (data.status === 'completed' || data.status === 'error') {
          setTimeout(() => {
            this.isProcessing.set(false);
            this.currentOperation.set('');
          }, 2000);
        }
      });
    }
  }

  async selectDirectory(title?: string): Promise<string | null> {
    if (!this.electronAPI) return null;
    return await this.electronAPI.selectDirectory(title);
  }

  async selectFile(title?: string, filters?: any[]): Promise<string | null> {
    if (!this.electronAPI) return null;
    return await this.electronAPI.selectFile(title, filters);
  }

  async getFilesFromDirectory(directoryPath: string): Promise<VideoFile[]> {
    if (!this.electronAPI) return [];
    return await this.electronAPI.getFilesFromDirectory(directoryPath);
  }

  async concatenateVideos(options: ConcatenateOptions): Promise<{ success: boolean; outputPath: string }> {
    if (!this.electronAPI) throw new Error('Electron API not available');
    this.currentOperation.set('Concatenating videos...');
    this.isProcessing.set(true);
    return await this.electronAPI.concatenateVideos(options);
  }

  async processVideo(options: ProcessOptions): Promise<{ success: boolean; outputPath: string }> {
    if (!this.electronAPI) throw new Error('Electron API not available');
    this.currentOperation.set('Processing video...');
    this.isProcessing.set(true);
    return await this.electronAPI.processVideo(options);
  }

  async getVideoMetadata(filePath: string): Promise<VideoMetadata> {
    if (!this.electronAPI) throw new Error('Electron API not available');
    return await this.electronAPI.getVideoMetadata(filePath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    if (!this.electronAPI) return false;
    return await this.electronAPI.fileExists(filePath);
  }

  async openExternal(filePath: string): Promise<boolean> {
    if (!this.electronAPI) return false;
    return await this.electronAPI.openExternal(filePath);
  }

  getProgressMessage(): string {
    const prog = this.progress();
    if (!prog) return '';

    switch (prog.status) {
      case 'started':
        return `${prog.operation === 'concatenate' ? 'Concatenation' : 'Processing'} started...`;
      case 'processing':
        const percent = prog.percent ? prog.percent.toFixed(2) : '0.00';
        const speed = prog.currentFps ? ` @ ${prog.currentFps} fps` : '';
        const time = prog.timemark ? ` (${prog.timemark})` : '';
        return `Progress: ${percent}%${speed}${time}`;
      case 'completed':
        return `${prog.operation === 'concatenate' ? 'Concatenation' : 'Processing'} completed successfully!`;
      case 'error':
        return `Error: ${prog.error || 'Unknown error'}`;
      default:
        return '';
    }
  }

  destroy() {
    if (this.progressUnsubscribe) {
      this.progressUnsubscribe();
    }
  }
}
