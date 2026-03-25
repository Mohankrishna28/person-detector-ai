from fastapi import FastAPI, File, UploadFile, Form, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import shutil
import os
import uuid
import asyncio

from color_matcher import parse_keywords
from detector import process_video_generator

app = FastAPI(title="GuardianTrace")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store
active_tasks = {}

# Ensure frontend dir exists so static mount doesn't fail on startup
os.makedirs("../frontend", exist_ok=True)
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

@app.get("/")
async def get_index():
    index_path = "../frontend/index.html"
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>GuardianTrace backend running. Waiting for frontend...</h1>")

@app.post("/upload")
async def upload_video(
    video: UploadFile = File(...), 
    description: str = Form(""),
    thermal_mode: bool = Form(False)
):
    if not video.filename.endswith(('.mp4', '.avi', '.mov', '.mkv')):
        return {"error": "Invalid video format", "status": "failed"}

    task_id = str(uuid.uuid4())
    temp_path = f"temp_{task_id}_{video.filename}"
    
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(video.file, buffer)
        
    keywords = parse_keywords(description)
    
    active_tasks[task_id] = {
        "video_path": temp_path,
        "keywords": keywords,
        "paused": False,
        "thermal_mode": thermal_mode
    }
    
    flat_keywords = []
    for t_colors, t_accs in keywords:
        flat_keywords.extend(list(t_colors))
        flat_keywords.extend(list(t_accs))

    return {
        "status": "success",
        "task_id": task_id, 
        "keywords_parsed": flat_keywords,
        "target_count": len(keywords)
    }
@app.post("/pause/{task_id}")
async def pause_task(task_id: str):
    if task_id in active_tasks:
        active_tasks[task_id]["paused"] = True
    return {"status": "paused"}

@app.post("/resume/{task_id}")
async def resume_task(task_id: str):
    if task_id in active_tasks:
        active_tasks[task_id]["paused"] = False
    return {"status": "resumed"}

@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()
    if task_id not in active_tasks:
        await websocket.send_json({"error": "Task not found"})
        await websocket.close(code=1000)
        return
        
    task = active_tasks[task_id]
    video_path = task["video_path"]
    keywords = task["keywords"]
    thermal_mode = task.get("thermal_mode", False)
    
    try:
        # stream frames
        async for frame_data in process_video_generator(video_path, keywords, thermal_mode):
            # Pause implementation
            while task_id in active_tasks and active_tasks[task_id].get("paused", False):
                await asyncio.sleep(0.2)
                
            if task_id not in active_tasks:
                break
                
            print(f"WS SENDING -> max_score: {frame_data.get('max_score')}, snaps: {len(frame_data.get('snapshots', []))}", flush=True)
            await websocket.send_json(frame_data)
            await asyncio.sleep(0.05)
            
        print(f"WS STREAM FINISHED", flush=True)
        await websocket.send_json({"status": "completed"})
    except WebSocketDisconnect:
        print(f"Client {task_id} disconnected")
    except Exception as e:
        print(f"Error processing video: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except:
            pass
    finally:
        # Cleanup temp video file and session
        if os.path.exists(video_path):
            try:
                os.remove(video_path)
            except:
                pass
        if task_id in active_tasks:
            del active_tasks[task_id]

# Dependency fixed

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
