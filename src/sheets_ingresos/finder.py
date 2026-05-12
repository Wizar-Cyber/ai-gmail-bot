from typing import Optional
import gspread
from ..sheets.finder import BaseSheetFinder


class IngresosSheetFinder(BaseSheetFinder):
    _BRAND_MODELS = {
        "mercedes": ["e200cabri", "e200", "gle450", "gle", "c200", "c200c", "gla", "glb", "glc", "gls", "cla"],
        "audi": ["q3", "q5", "q7", "q8", "a3", "a4", "a5", "a6", "a7", "tt"],
        "bmw": ["x1", "x2", "x3", "x4", "x5", "x6", "x7"],
        "toyota": ["corolla", "camry", "rav4", "highlander", "prado", "txl", "xl"],
        "honda": ["civic", "accord", "crv", "pilot"],
        "ford": ["fiesta", "focus", "fusion", "escape", "explorer"],
        "chevrolet": ["cruze", "malibu", "equinox", "traverse"],
        "nissan": ["sentra", "altima", "rogue", "pathfinder"],
    }
