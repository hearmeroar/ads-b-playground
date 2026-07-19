# Use official Python runtime as a parent image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 7860

# Set environment variables
ENV PORT=7860
ENV PYTHONUNBUFFERED=1

# gthread (not sync) workers: the app fans out several blocking
# requests.get() calls per poll (one per enabled source) and any single
# slow/unreachable upstream (observed: opensky-network.org can hang for a
# full connect-timeout from some hosts) must not starve every other
# concurrent request. 2 processes x 8 threads gives 16 concurrent
# request-handling slots without the memory cost of 16 separate workers.
CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--worker-class", "gthread", "--workers", "2", "--threads", "8", "--timeout", "60", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
