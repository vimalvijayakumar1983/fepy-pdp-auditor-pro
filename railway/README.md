# Railway worker

Not deployed yet. Railway is not connected to this workspace.

When Railway is connected, deploy this folder as a service:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Set AUDITOR_WORKER_URL on the Vercel project to the Railway URL. Do not put API keys in the repo.
