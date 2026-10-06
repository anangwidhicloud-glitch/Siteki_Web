import re
import json
import pypdf

# Common alias dictionary mapping PDF names to DB names or normalized keys
ALIASES = {
    'instalasi stop kontak': 'ins. stop kontak',
    'ins. stop kontak': 'ins. stop kontak',
    'coil pad': 'coilpad',
    'coilpad': 'coilpad',
    'baut dan mur': 'baut dan mur',
    'pto ( power take off)': 'pto (power take off)',
    'pto (power take off)': 'pto (power take off)',
}

def norm(s):
    if not s:
        return ""
    cleaned = re.sub(r'\s+', ' ', str(s).strip()).lower()
    return ALIASES.get(cleaned, cleaned)

def test_alias():
    with open('parsed_pdf_items.json', 'r', encoding='utf-8') as f:
        pdf_records = json.load(f)

    # Read DB distinct items per machine
    import pg
    import os
    
    env_file = open('.env').read()
    line = [l for l in env_file.splitlines() if 'DATABASE_URL' in l][0]
    db_url = line.split('=')[1].strip().strip("'\"")

    conn = pg.connect(db_url, sslmode='require')
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT
          lower(trim(i.machine_name)) AS nama,
          CASE WHEN upper(i.schedule_code)='B' OR lower(i.maintenance_type) LIKE '%bulan%' THEN 'Bulanan' ELSE 'Mingguan' END AS per,
          ci.name AS db_item
        FROM maintenance_inspections i
        JOIN maintenance_check_results cr ON cr.inspection_id = i.id
        JOIN maintenance_check_items ci ON ci.id = cr.item_id
    """)
    db_rows = cur.fetchall()
    
    db_set = set()
    for nama, per, db_item in db_rows:
        db_set.add((norm(nama), norm(per), norm(db_item)))
        
    print('DB Set total entries:', len(db_set))

    matched_records = []
    excluded_records = []

    for r in pdf_records:
        key = (norm(r['nama']), norm(r['perawatan']), norm(r['item']))
        if key in db_set:
            matched_records.append(r)
        else:
            excluded_records.append(r)

    print('Matched records:', len(matched_records))
    print('Excluded records:', len(excluded_records))

    print('\nSample Excluded Records (In PDF, but NO inspection record in DB for that machine & schedule & item):')
    for r in excluded_records[:20]:
        print(' ', f"{r['nama']} ({r['perawatan']}): '{r['item']}'")

test_alias()
