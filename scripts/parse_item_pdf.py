import re
import json
import pypdf

KNOWN_JENIS = [
    'Mobile Crane', 'Potong Bahan', 'Pipa ERW', 'Pipa Erw', 'Alat Uji',
    'Forklift', 'Trailler', 'Umum', 'Dump', 'Verloop', 'Lakop', 'Kop',
    'Perakitan', 'Bevel', 'Kompressor', 'Genset', 'Slitting', 'Crane', 'Pipa', 'Lainnya'
]
# Sort by length descending so multi-word jenis like 'Mobile Crane', 'Potong Bahan', 'Pipa ERW' match first!
KNOWN_JENIS.sort(key=len, reverse=True)

def parse_pdf(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    records = []
    
    # We maintain sort order per (nama, perawatan)
    item_counter = {}

    for page_idx, page in enumerate(reader.pages):
        text = page.extract_text()
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        
        for line in lines:
            if line.startswith('Kategori') or line.startswith('JENIS'):
                continue
            
            match = re.match(r'^(Armada|Mesin)\s+(.*?)\s+\b(M|B)\b\s+(.+)$', line)
            if not match:
                print(f"Warning: Line on page {page_idx+1} didn't match regex: {line}")
                continue
            
            kategori, middle, raw_per, item_name = match.groups()
            perawatan = 'Bulanan' if raw_per.upper() == 'B' else 'Mingguan'
            
            # Extract jenis and nama from middle
            matched_jenis = None
            nama_mesin = None
            
            for j in KNOWN_JENIS:
                if middle.lower().startswith(j.lower()):
                    matched_jenis = j
                    nama_mesin = middle[len(j):].strip()
                    break
            
            if not matched_jenis:
                # Fallback split
                parts = middle.split(' ', 1)
                matched_jenis = parts[0]
                nama_mesin = parts[1] if len(parts) > 1 else parts[0]
            
            if not nama_mesin:
                nama_mesin = middle
            
            # Normalize jenis casing
            if matched_jenis.lower() == 'pipa erw':
                matched_jenis = 'Pipa ERW'
            elif matched_jenis.lower() == 'mobile crane':
                matched_jenis = 'Mobile Crane'
            elif matched_jenis.lower() == 'potong bahan':
                matched_jenis = 'Potong Bahan'
            else:
                matched_jenis = matched_jenis.title()
                
            key = f"{nama_mesin}|{perawatan}"
            item_counter[key] = item_counter.get(key, 0) + 1
            sort_order = item_counter[key]
            
            records.append({
                'kategori': kategori,
                'jenis': matched_jenis,
                'nama': nama_mesin,
                'perawatan': perawatan,
                'schedule_code': raw_per.upper(),
                'item': item_name,
                'sort_order': sort_order
            })
            
    return records

if __name__ == '__main__':
    records = parse_pdf(r'D:\01. Pribadi\Website\05. SiTeki\Item.pdf')
    print('Total parsed records from Item.pdf:', len(records))
    print('Sample records:')
    for r in records[:10]:
        print(r)
    
    # Save as JSON for inspection
    with open('parsed_pdf_items.json', 'w', encoding='utf-8') as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
