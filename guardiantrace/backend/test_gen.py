import asyncio
import os
import glob
from detector import process_video_generator

async def main():
    videos = glob.glob("temp_*.mp4")
    if not videos:
        print("No temp videos found.")
        return
    
    vid = max(videos, key=os.path.getmtime)
    print(f"Testing against {vid}")
    
    # Simulate user's query: 'brown dress' -> ({'brown'}, set())
    keywords = ({'brown'}, set())
    
    async for frame in process_video_generator(vid, keywords):
        if frame.get('snapshots'):
            print(f"SNAP! {frame.get('timestamp')} count={len(frame['snapshots'])}")
        elif frame.get('max_score', 0) >= 80:
            print(f"Score {frame.get('max_score')} but no snap at {frame.get('timestamp')}")

if __name__ == "__main__":
    asyncio.run(main())
