"""Build the licensed static PI font with fonttools==4.65.0 (offline tooling)."""

import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

font = TTFont(sys.argv[1], recalcTimestamp=False)
instantiateVariableFont(font, {"wght": 400}, inplace=True)
options = subset.Options()
options.hinting = False
options.layout_features = ["*"]
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=font.getBestCmap().keys())
subsetter.subset(font)
names = {1: "Pi CJK Sans", 2: "Regular", 3: "PiCjkSans-Regular-2.004", 4: "Pi CJK Sans Regular", 6: "PiCjkSans-Regular", 16: "Pi CJK Sans", 17: "Regular"}
for record in font["name"].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.save(sys.argv[2])
