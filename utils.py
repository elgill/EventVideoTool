def format_eta(eta):
    if eta is None:
        return "N/A"
    else:
        # Calculate the hours, minutes, and seconds
        hours = int(eta // 3600)
        minutes = int((eta % 3600) // 60)
        seconds = eta % 60

        # Build a formatted string based on the values
        if hours > 0:
            return f"{hours}h {minutes}m {seconds:.1f}s"
        elif minutes > 0:
            return f"{minutes}m {seconds:.1f}s"
        else:
            return f"{seconds:.1f} seconds"