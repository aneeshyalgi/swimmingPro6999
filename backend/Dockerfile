# Build context: backend. Supply Supabase, OpenAI, Stripe, and CORS settings at runtime.
FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 appuser
COPY --chown=appuser:appuser app/*.py ./app/
# The premade training plans' books (scripts/build_plan_books.py), served only to their buyers.
COPY --chown=appuser:appuser plan_books/ ./plan_books/

USER appuser
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\""]
