from PIL import Image
import sys

try:
    img = Image.open("resources/icon.png")
    print(f"Format: {img.format}")
    print(f"Size: {img.size}")
    print(f"Mode: {img.mode}")
    
    # Check extremes
    extrema = img.getextrema()
    print(f"Extrema: {extrema}")
    
    # Sample a few pixels
    print(f"Pixel (0,0): {img.getpixel((0,0))}")
    print(f"Pixel (128,128): {img.getpixel((128,128))}")
    
    # Check if all pixels are the same
    # simplified check
    first_pixel = img.getpixel((0,0))
    is_solid = True
    for x in range(0, img.width, 10):
        for y in range(0, img.height, 10):
            if img.getpixel((x,y)) != first_pixel:
                is_solid = False
                break
        if not is_solid: break
        
    print(f"Is solid color? {is_solid}")

except Exception as e:
    print(f"Error: {e}")
