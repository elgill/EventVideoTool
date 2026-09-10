import platform
import subprocess


def get_hardware_encoder():
    system = platform.system().lower()

    if system == "darwin":  # macOS
        return get_mac_encoder()
    elif system == "windows":
        return get_windows_encoder()
    elif system == "linux":
        return get_linux_encoder()
    else:
        return None  # Unknown system, fallback to software encoding


def get_mac_encoder():
    # macOS typically uses VideoToolbox
    return "h264_videotoolbox"


def get_windows_encoder():
    # Check for NVIDIA, AMD, and Intel GPUs
    if check_nvidia_gpu():
        return "h264_nvenc"
    elif check_amd_gpu():
        return "h264_amf"
    elif check_intel_gpu():
        return "h264_qsv"
    return None


def get_linux_encoder():
    # Similar to Windows, but might require different detection methods
    if check_nvidia_gpu():
        return "h264_nvenc"
    elif check_amd_gpu():
        return "h264_vaapi"  # VAAPI is often used on Linux
    elif check_intel_gpu():
        return "h264_qsv"
    return None


def check_nvidia_gpu():
    try:
        # This command works on Windows and Linux
        subprocess.check_output(["nvidia-smi"])
        return True
    except:
        return False


def check_amd_gpu():
    # This is a simplified check and might need to be more robust
    try:
        if platform.system().lower() == "windows":
            output = subprocess.check_output(["wmic", "path", "win32_VideoController", "get", "name"]).decode()
        else:  # Linux
            output = subprocess.check_output(["lspci"]).decode()
        return "AMD" in output or "Radeon" in output
    except:
        return False


def check_intel_gpu():
    # This is a simplified check and might need to be more robust
    try:
        if platform.system().lower() == "windows":
            output = subprocess.check_output(["wmic", "path", "win32_VideoController", "get", "name"]).decode()
        else:  # Linux
            output = subprocess.check_output(["lspci"]).decode()
        return "Intel" in output and ("HD Graphics" in output or "UHD Graphics" in output)
    except:
        return False