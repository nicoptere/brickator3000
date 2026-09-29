#!/usr/bin/env python3
"""
LDraw Official Model Repository (OMR) Downloader.

Crawls all set numbers from https://library.ldraw.org/omr/sets?page=1..N
and downloads all official .mpd files into /mnt/storage/projects/brickator3000/docs/omr_gallery.
"""

import os
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

DEST_DIR = "/mnt/storage/projects/brickator3000/docs/omr_gallery"
os.makedirs(DEST_DIR, exist_ok=True)

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

def fetch_page_set_numbers(page: int) -> set:
    url = f"https://library.ldraw.org/omr/sets?page={page}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
            # Extract set numbers like 10001-1, 6080-1, etc.
            found = set(re.findall(r'\b\d{3,6}-\d+\b', html))
            return found
    except Exception as e:
        print(f"Error fetching page {page}: {e}")
        return set()

def download_omr_file(set_num: str) -> tuple:
    # Check if already downloaded (either exact or with name suffix)
    for fname in os.listdir(DEST_DIR):
        if fname.startswith(f"{set_num}") and fname.endswith(".mpd"):
            return (set_num, True, "already exists", len(fname))
    
    target_path = os.path.join(DEST_DIR, f"{set_num}.mpd")
    url = f"https://library.ldraw.org/library/omr/{set_num}.mpd"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
            if len(data) > 0 and (b"0 FILE" in data or b"0 Name" in data or b"!LDRAW_ORG" in data or b"0 " in data):
                with open(target_path, "wb") as f:
                    f.write(data)
                return (set_num, True, "downloaded", len(data))
            else:
                return (set_num, False, "invalid content", len(data))
    except Exception as e:
        return (set_num, False, str(e), 0)

def main():
    print("=== Phase 1: Collecting all OMR set IDs from library.ldraw.org ===")
    all_set_numbers = set()
    consecutive_empty = 0
    
    # 60 pages covers 1470 results at 25 per page
    for page in range(1, 70):
        sets = fetch_page_set_numbers(page)
        if not sets:
            consecutive_empty += 1
            if consecutive_empty >= 3:
                print(f"Stopping after 3 consecutive empty pages at page {page}.")
                break
        else:
            consecutive_empty = 0
            new_sets = sets - all_set_numbers
            all_set_numbers.update(sets)
            print(f"Page {page:02d}: +{len(new_sets)} new sets (Total unique: {len(all_set_numbers)})")
        time.sleep(0.1)

    print(f"\n=== Phase 2: Downloading {len(all_set_numbers)} official OMR models ===")
    success_count = 0
    exist_count = 0
    fail_count = 0
    
    # Download with 8 worker threads
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = {executor.submit(download_omr_file, s): s for s in sorted(all_set_numbers)}
        for future in as_completed(futures):
            set_num, ok, status, size = future.result()
            if ok:
                if status == "already exists":
                    exist_count += 1
                else:
                    success_count += 1
                    if success_count % 25 == 0:
                        print(f"Downloaded {success_count} models so far...")
            else:
                fail_count += 1

    total_files = len([f for f in os.listdir(DEST_DIR) if f.endswith(".mpd")])
    print(f"\n=== Download Complete! ===")
    print(f"New downloads: {success_count}")
    print(f"Pre-existing: {exist_count}")
    print(f"Failed/Missing on server: {fail_count}")
    print(f"Total OMR files in {DEST_DIR}: {total_files}")

if __name__ == "__main__":
    main()
