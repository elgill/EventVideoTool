import os
import sys


def get_ffmpeg_path():
    base_path = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, 'bin', get_ffmpeg_binary())


def get_ffmpeg_binary():
    if sys.platform.startswith('linux'):
        return 'ffmpeg'
    elif sys.platform.startswith('darwin'):
        return 'ffmpeg'
    elif sys.platform.startswith('win32'):
        return 'ffmpeg.exe'
    else:
        raise RuntimeError('Unsupported operating system')
