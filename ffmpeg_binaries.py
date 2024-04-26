import os
import sys


def get_ffmpeg_path():
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, 'bin', get_ffmpeg_binary())


def get_ffprobe_path():
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, 'bin', get_ffprobe_binary())


def get_ffmpeg_binary():
    if sys.platform.startswith('linux'):
        return os.path.join('linux', 'ffmpeg')
    elif sys.platform.startswith('darwin'):
        return os.path.join('mac', 'ffmpeg')
    elif sys.platform.startswith('win32'):
        return os.path.join('win', 'ffmpeg.exe')
    else:
        raise RuntimeError('Unsupported operating system')


def get_ffprobe_binary():
    if sys.platform.startswith('linux'):
        return os.path.join('linux', 'ffprobe')
    elif sys.platform.startswith('darwin'):
        return os.path.join('mac', 'ffprobe')
    elif sys.platform.startswith('win32'):
        return os.path.join('win', 'ffprobe.exe')
    else:
        raise RuntimeError('Unsupported operating system')