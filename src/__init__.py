"""
Sistema de Automatización de Reportes Kilométricos
"""

__version__ = "1.0.0"

from .pipeline import KilometerPipeline
from .models import Vehicle, DailyEntry, VehicleReport, ProcessingResult
from .gmail import GmailAuthManager, GmailService
from .excel import ExcelUpdater
from .storage import Database

__all__ = [
    'KilometerPipeline',
    'Vehicle',
    'DailyEntry',
    'VehicleReport',
    'ProcessingResult',
    'GmailAuthManager',
    'GmailService',
    'ExcelUpdater',
    'Database',
]