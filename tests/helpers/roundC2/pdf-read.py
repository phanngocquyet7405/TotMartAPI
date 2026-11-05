import json
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import fitz
source, root = Path(sys.argv[2]), Path(sys.argv[3])
out = root / "pdf"
out.mkdir(exist_ok=True)
doc = fitz.open(source)
text = []
for index, page in enumerate(doc):
    text.append(f"PAGE {index + 1}\n{page.get_text()}\n")
    page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2)).save(out / f"page-{index + 1}.png")
(out / "rubric.txt").write_text("\n".join(text), encoding="utf-8")
(out / "pages.json").write_text(json.dumps({"pages": len(doc)}, indent=2), encoding="utf-8")
