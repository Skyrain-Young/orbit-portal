FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m dio
COPY server.py usage.py players.py galaxies.py ./
COPY web/portal web/portal
COPY web/admin web/admin
COPY web/catalog.json web/catalog.json
RUN mkdir /app/data && chown dio:dio /app/data
USER dio
ARG DIO_REVISION=development
ENV DIO_REVISION=${DIO_REVISION}
LABEL org.opencontainers.image.revision=${DIO_REVISION}
ENV DIO_DATA_DIR=/app/data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz')"
CMD ["python", "server.py", "--host", "0.0.0.0"]
