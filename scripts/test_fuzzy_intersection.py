import re
import json
import pypdf

def norm(s):
    if not s:
        return ""
    # Trim whitespace, replace multiple spaces with single space, lowercase
    return re.sub(r'\s+', ' ', str(s).strip()).lower()

def test_matching():
    with open('parsed_pdf_items.json', 'r', encoding='utf-8') as f:
        pdf_records = json.load(f)

    # Let's inspect items with 'stop kontak' in PDF and in DB!
    stop_kontak_pdf = [r for r in pdf_records if 'stop kontak' in norm(r['item'])]
    print('PDF items with "stop kontak":', len(stop_kontak_pdf))
    for r in stop_kontak_pdf[:5]:
        print(' ', r)

test_matching()
