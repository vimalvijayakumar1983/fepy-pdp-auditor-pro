from fastapi import FastAPI

app = FastAPI(title="FEPY PDP auditor worker")

@app.get("/health")
def health():
    return {"ok": True, "embeddings": "not-enabled", "note": "Rules audit runs on Vercel. This worker is for a later EmbeddingGemma pass."}
