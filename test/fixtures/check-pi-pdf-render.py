"""Raster and page-boundary checks for the explicit PI PDF acceptance run."""

import json
import sys

import pypdfium2 as pdfium


document = pdfium.PdfDocument(sys.argv[1])
reports = []
for index in range(len(document)):
    page = document[index]
    text = page.get_textpage()
    width, height = page.get_size()
    for character in range(text.count_chars()):
        value = text.get_text_range(character, 1)
        if not value.strip():
            continue
        left, bottom, right, top = text.get_charbox(character)
        assert left >= 0 and bottom >= 0, (index, value, "outside page")
        assert right <= width and top <= height, (index, value, "clipped")
    bitmap = page.render(scale=1.5)
    raster = bitmap.to_pil().convert("L")
    histogram = raster.histogram()
    ink = sum(histogram[:200])
    assert ink > 500, (index, "blank rendered page")
    assert ink < raster.width * raster.height * 0.4, (index, "excessive ink")
    # The renderer reserves a margin on every side, including its footer.
    border = 12
    for box in [
        (0, 0, raster.width, border),
        (0, raster.height - border, raster.width, raster.height),
        (0, 0, border, raster.height),
        (raster.width - border, 0, raster.width, raster.height),
    ]:
        assert raster.crop(box).getextrema()[0] >= 240, (index, "margin ink")
    reports.append({"page": index + 1, "inkPixels": ink})
    text.close()
    bitmap.close()
    page.close()
document.close()
print(json.dumps(reports))
