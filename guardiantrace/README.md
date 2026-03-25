# 🛡️ GuardianTrace

**GuardianTrace** is a real-time, privacy-first missing person finder system. It uses YOLOv8 for person detection and OpenCV for HSV color extraction to match natural language clothing descriptions directly on video feeds, **without using any facial recognition or collecting biometric data**.

## 🚀 5-Minute Setup Guide (Hackathon Ready)

Follow these steps to get GuardianTrace running locally immediately.

### 1. Install Dependencies
You need Python 3.8+ installed. Navigate to the `guardiantrace/backend` folder and install the required packages:

```bash
cd guardiantrace/backend
pip install -r requirements.txt
```

*(Note: The first time you run the backend, it will automatically download the lightweight `yolov8n.pt` model file which is ~6MB).*

### 2. Run the Backend Server
Start the FastAPI server using Uvicorn from inside the `backend` directory:

```bash
# Ensure you are inside the backend directory
uvicorn main:app --reload
```
The backend initializes the YOLOv8 model and binds the WebSocket stream channel to port 8000.

### 3. Open the Frontend
The frontend is built with pure HTML/CSS/JS and served directly by the backend.
Simply open your web browser and navigate to:
👉 **[http://localhost:8000](http://localhost:8000)**

### 4. Test with a Sample Video
1. **Prepare video**: Find or record a short video (MP4, AVI, MOV) of people walking. (e.g., someone wearing a red shirt and black pants).
2. **Enter query**: In the "Target Description" box, enter a simple description like `red shirt black pants` or `blue shirt`.
3. **Upload**: Click "Browse Files" and upload your sample video.
4. **Initiate Trace**: Click the **Initiate Trace** button.
5. **Watch**: The system will stream the video in real-time. 
   - **Green Bounding Boxes**: Positive matches (Score ≥ 70%). The UI will dynamically glow green and play a synthetic alert beep.
   - **Red Bounding Boxes**: Non-matches, showing their respective color similarity scores.

## 🔒 Privacy First
GuardianTrace is built on the philosophy that missing persons can be found without compromising the privacy of the public. 
- **NO** facial recognition algorithms are used.
- **NO** biometric data is saved or tracked.
- **NO** cloud inference is required; everything runs locally on your machine.
- Video files are temporarily processed and immediately deleted after the stream ends.
