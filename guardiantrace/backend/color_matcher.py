import cv2
import numpy as np

# HSV ranges for common colors
# Note: OpenCV uses H: 0-179, S: 0-255, V: 0-255
COLOR_RANGES = {
    'red': [
        ((0, 50, 50), (10, 255, 255)),
        ((170, 50, 50), (180, 255, 255))
    ],
    'orange': [((11, 50, 121), (25, 255, 255))],
    'yellow': [((26, 50, 50), (35, 255, 255))],
    'green':  [((36, 40, 40), (85, 255, 255))],
    'blue':   [((86, 40, 40), (125, 255, 255))],
    'purple': [((126, 40, 40), (169, 255, 255))],
    'brown':  [((8, 50, 20), (22, 255, 120))],
    'white':  [((0, 0, 200), (180, 40, 255))],
    'black':  [((0, 0, 0), (180, 255, 50))],
    'gray':   [((0, 0, 51), (180, 40, 199))]
}

ACCESSORY_CLASSES = {
    'backpack': 24,
    'umbrella': 25,
    'handbag': 26,
    'tie': 27,
    'suitcase': 28
}

def get_dominant_color(image_bgr):
    """
    Given a BGR image crop, return the best matching color name.
    """
    if image_bgr is None or image_bgr.size == 0:
        return ""

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    max_count = 0
    best_color = ""

    for color_name, ranges in COLOR_RANGES.items():
        mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
        for (lower, upper) in ranges:
            lower_np = np.array(lower, dtype=np.uint8)
            upper_np = np.array(upper, dtype=np.uint8)
            color_mask = cv2.inRange(hsv, lower_np, upper_np)
            mask = cv2.bitwise_or(mask, color_mask)
        
        count = cv2.countNonZero(mask)
        if count > max_count:
            max_count = count
            best_color = color_name
            
    return best_color

def parse_keywords(description: str):
    """
    Extracts recognizable color and accessory keywords from the user's description.
    Supports multiple targets separated by ' AND ' or ','.
    Returns a list of tuples: [(set of colors, set of accessories), ...]
    """
    if not description:
        return []
        
    description = description.lower().replace(',', ' and ')
    target_queries = [t.strip() for t in description.split(' and ') if t.strip()]
    
    parsed_targets = []
    for query in target_queries:
        words = query.split()
        found_colors = set()
        found_accessories = set()
        for word in words:
            clean_word = word.strip('.,!?;:')
            if clean_word in COLOR_RANGES:
                found_colors.add(clean_word)
            if clean_word in ACCESSORY_CLASSES:
                found_accessories.add(clean_word)
        
        # Add even if empty, so the target indices match up reliably, or just skip empties.
        # It's better to add them if they typed 'and' to guarantee index routing maps correctly
        if found_colors or found_accessories:
            parsed_targets.append((found_colors, found_accessories))
            
    return parsed_targets

def calculate_match_score(target_colors: set, target_accessories: set, 
                          top_color: str, bottom_color: str, detected_accessories: set):
    """
    Returns a score from 0-100 indicating how well the extracted colors and objects match.
    """
    total_targets = len(target_colors) + len(target_accessories)
    if total_targets == 0:
        return 0
        
    extracted_colors = set()
    if top_color:
        extracted_colors.add(top_color)
    if bottom_color:
        extracted_colors.add(bottom_color)
        
    color_matches = len(target_colors.intersection(extracted_colors))
    accessory_matches = len(target_accessories.intersection(detected_accessories))
    
    # Reveal partial matches in UI: if they asked for an accessory and it's missing,
    # cap the score at 50% instead of dropping it to 0. 
    # This prevents false positives from hitting 70% (green), but still draws a red box.
    if len(target_accessories) > 0 and accessory_matches == 0:
        max_possible_score = int((color_matches / total_targets) * 100)
        return min(50, max_possible_score)

    score = ((color_matches + accessory_matches) / total_targets) * 100
    return int(score)
