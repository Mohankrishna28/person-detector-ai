import cv2
import base64
import asyncio
from ultralytics import YOLO
from color_matcher import get_dominant_color, calculate_match_score

# Load YOLO model
model = YOLO('yolov8n.pt')

# Target Bounding Box Colors (Green, Cyan, Magenta, Orange)
TARGET_PALETTE = [(0, 255, 0), (255, 255, 0), (255, 0, 255), (0, 165, 255)]

async def process_video_generator(video_path: str, target_keywords_list: list, thermal_mode: bool = False):
    """
    Generator that processes the video frame by frame, runs YOLO, extracts colors and accessories,
    scores each person against multiple targets concurrently, and yields snapshots routed by target index.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise Exception(f"Could not open video {video_path}")
        
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 30
        
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        total_frames = 1
        
    try:
        frame_count = 0
        last_snapshot_secs = {}
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            frame_count += 1
            progress_pct = min(100.0, (frame_count / total_frames) * 100.0)
            
            # Calculate timestamp
            sec = int(frame_count / fps)
            timestamp_str = f"[{sec // 60:02d}:{sec % 60:02d}]"
            
            # Process every 10th frame to guarantee massive fast-forward effect regardless of CPU
            if frame_count % 10 != 0:
                continue
                
            # Run YOLO tracking for person detection (0) and accessories
            results = await asyncio.to_thread(model.track, frame, persist=True, classes=[0, 24, 25, 26, 27, 28], verbose=False, imgsz=320)
            
            if thermal_mode:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                display_frame = cv2.applyColorMap(gray, cv2.COLORMAP_INFERNO)
            else:
                display_frame = frame.copy()
                
            # RESIZE DISPLAY FRAME TO PREVENT WEBSOCKET BUFFER OVERFLOW (Errno 22)
            h, w = display_frame.shape[:2]
            max_width = 800
            if w > max_width:
                scale = max_width / w
                new_w, new_h = int(w * scale), int(h * scale)
                display_frame = cv2.resize(display_frame, (new_w, new_h))
                
            # Also scale down detection boxes to match the new display frame size for drawing
            scale_factor = max_width / w if w > max_width else 1.0
                
            max_score_in_frame = 0
            frame_snapshots = []
            
            for result in results:
                boxes = result.boxes
                people = []
                accessories = []
                
                # Separate into people and accessories
                for box in boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cls_id = int(box.cls[0])
                    track_id = int(box.id[0]) if box.id is not None else -1
                    
                    if cls_id == 0:
                        people.append((track_id, x1, y1, x2, y2))
                    else:
                        cls_name = model.names[cls_id]
                        accessories.append((cls_name, x1, y1, x2, y2))
                        
                # Process each person
                for track_id, px1, py1, px2, py2 in people:
                    h, w = frame.shape[:2]
                    px1, py1 = max(0, px1), max(0, py1)
                    px2, py2 = min(w, px2), min(h, py2)
                    
                    person_crop = frame[py1:py2, px1:px2]
                    if person_crop.size == 0 or person_crop.shape[0] < 10 or person_crop.shape[1] < 10:
                        continue
                        
                    ph, pw = person_crop.shape[:2]
                    mid_y = ph // 2
                    
                    top_half = person_crop[0:mid_y, 0:pw]
                    bottom_half = person_crop[mid_y:ph, 0:pw]
                    
                    top_color = get_dominant_color(top_half)
                    bottom_color = get_dominant_color(bottom_half)
                    
                    # Check which accessories overlap with this person
                    detected_accs = set()
                    for acc_name, ax1, ay1, ax2, ay2 in accessories:
                        # Simple overlap check: center of accessory is inside person box
                        cx = (ax1 + ax2) // 2
                        cy = (ay1 + ay2) // 2
                        if px1 <= cx <= px2 and py1 <= cy <= py2:
                            detected_accs.add(acc_name)
                    
                    # Evaluate against multiple targets
                    best_score = 0
                    best_target_idx = -1
                    
                    for idx, (t_colors, t_accs) in enumerate(target_keywords_list):
                        score = calculate_match_score(t_colors, t_accs, top_color, bottom_color, detected_accs)
                        if score > best_score:
                            best_score = score
                            best_target_idx = idx
                    
                    if best_score > max_score_in_frame:
                        max_score_in_frame = best_score
                        
                    if best_score >= 70 and best_target_idx != -1:
                        color = TARGET_PALETTE[best_target_idx % len(TARGET_PALETTE)]
                        acc_str = f" +{','.join(detected_accs)}" if detected_accs else ""
                        id_str = f"ID:{track_id} " if track_id != -1 else ""
                        label = f"T{best_target_idx} {id_str}Match: {best_score}%{acc_str}"
                        thickness = 3
                        
                        # Handle individual target snapshot timings
                        snap_key = (best_target_idx, track_id)
                        if best_score >= 80 and (sec - last_snapshot_secs.get(snap_key, -5)) >= 3:
                            _, snap_buffer = cv2.imencode('.jpg', person_crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
                            snap_b64 = base64.b64encode(snap_buffer).decode('utf-8')
                            display_id = track_id if track_id != -1 else f"Lck-{sec}"
                            
                            frame_snapshots.append({
                                "id": display_id,
                                "target_index": best_target_idx,
                                "image": f"data:image/jpeg;base64,{snap_b64}",
                                "timestamp": timestamp_str
                            })
                            last_snapshot_secs[snap_key] = sec
                    else:
                        color = (0, 0, 255)
                        id_str = f"ID:{track_id} " if track_id != -1 else ""
                        label = f"{id_str}Score: {best_score}%"
                        thickness = 2
                        
                    d_px1, d_py1 = int(px1 * scale_factor), int(py1 * scale_factor)
                    d_px2, d_py2 = int(px2 * scale_factor), int(py2 * scale_factor)

                    cv2.rectangle(display_frame, (d_px1, d_py1), (d_px2, d_py2), color, thickness)
                    cv2.putText(display_frame, label, (d_px1, d_py1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, thickness)
                    
                    color_label = f"T:{top_color} B:{bottom_color}"
                    cv2.putText(display_frame, color_label, (d_px1, d_py2 + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

                    # Draw accessory boxes within person (cyan)
                    for acc_name in detected_accs:
                        for a_name, ax1, ay1, ax2, ay2 in accessories:
                            if a_name == acc_name:
                                d_ax1, d_ay1 = int(ax1 * scale_factor), int(ay1 * scale_factor)
                                d_ax2, d_ay2 = int(ax2 * scale_factor), int(ay2 * scale_factor)
                                cv2.rectangle(display_frame, (d_ax1, d_ay1), (d_ax2, d_ay2), (255, 255, 0), 1)
                                cv2.putText(display_frame, a_name, (d_ax1, d_ay1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 0), 1)
            
            # Draw Timestamp in top-left
            cv2.putText(display_frame, f"Time: {timestamp_str}", (15, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            
            # JPEG compression
            _, buffer = cv2.imencode('.jpg', display_frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            b64_img = base64.b64encode(buffer).decode('utf-8')
            
            yield {
                "image": f"data:image/jpeg;base64,{b64_img}",
                "max_score": max_score_in_frame,
                "timestamp": timestamp_str,
                "progress_pct": progress_pct,
                "snapshots": frame_snapshots
            }
            
            # Yield to event loop instantly without forcing slow playback
            await asyncio.sleep(0.001)
            
    finally:
        cap.release()
