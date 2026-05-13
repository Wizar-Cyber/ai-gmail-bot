"""Command-line entry point for the AI Gmail Bot kilometrage processing system."""

import argparse
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from dotenv import load_dotenv
load_dotenv()

from src.pipeline import KilometerPipeline


def main():
    """Parse CLI arguments and execute the appropriate pipeline flow."""
    parser = argparse.ArgumentParser(
        description="Sistema de automatización de reportes kilométricos"
    )

    parser.add_argument(
        "--excel",
        type=str,
        default=None,
        help="Ruta al archivo Excel local (opcional si se usa --sheets-id)"
    )

    parser.add_argument(
        "--sheets-id",
        type=str,
        default=os.getenv("GOOGLE_SHEETS_ID"),
        help="ID del Google Sheet de kilometraje (o variable GOOGLE_SHEETS_ID)"
    )

    parser.add_argument(
        "--sheets-ingresos-id",
        type=str,
        default=os.getenv("GOOGLE_SHEETS_INGRESOS_ID"),
        help="ID del Google Sheet de ingresos/gastos (o variable GOOGLE_SHEETS_INGRESOS_ID)"
    )

    parser.add_argument(
        "--service-account",
        type=str,
        default=os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json"),
        help="Ruta al JSON de Service Account (o variable GOOGLE_SERVICE_ACCOUNT_FILE)"
    )

    parser.add_argument(
        "--max-emails",
        type=int,
        default=10,
        help="Máximo de emails a procesar"
    )

    parser.add_argument(
        "--query",
        type=str,
        default=None,
        help="Query de búsqueda Gmail"
    )

    parser.add_argument(
        "--pdf",
        type=str,
        default=None,
        help="Procesar un PDF específico (sin Gmail)"
    )

    parser.add_argument(
        "--data-dir",
        type=str,
        default="data",
        help="Directorio para datos descargados"
    )

    parser.add_argument(
        "--db-url",
        type=str,
        default=os.getenv("DATABASE_URL"),
        help="URL de conexión a base de datos (por defecto SQLite local)"
    )

    parser.add_argument(
        "--update-summary",
        action="store_true",
        help="Actualizar fórmulas en hoja Total y Resumen"
    )

    parser.add_argument(
        "--summary-year",
        type=int,
        default=2026,
        help="Año para fórmulas del resumen (default: 2026)"
    )

    parser.add_argument(
        "--enable-ingresos",
        action="store_true",
        help="Habilitar escritura en hoja de ingresos/gastos"
    )

    args = parser.parse_args()

    default_excel = "KILOMETRAJE Y DEPRECIACION VEHICULOS 2026 (1).xlsx"
    excel_path = args.excel

    if not excel_path and os.path.exists(default_excel):
        excel_path = default_excel

    if not excel_path and not args.sheets_id:
        print("ERROR: debes especificar --excel, --sheets-id, o ambos.")
        sys.exit(1)

    if excel_path and not os.path.exists(excel_path):
        print(f"ERROR: Excel no encontrado: {excel_path}")
        sys.exit(1)

    pipeline = KilometerPipeline(
        excel_path=excel_path,
        data_dir=args.data_dir,
        db_url=args.db_url,
        sheets_id=args.sheets_id,
        sheets_ingresos_id=args.sheets_ingresos_id,
        service_account_file=args.service_account,
        enable_ingresos=args.enable_ingresos,
    )

    if args.update_summary:
        count = pipeline.update_summary_formulas(year=args.summary_year)
        print(f"\n✓ Resumen actualizado: {count} fórmulas escritas")
        return

    if args.pdf:
        reports = pipeline.process_single_pdf(args.pdf)
        pipeline.update_summary_formulas(year=args.summary_year)
        print(f"\n✓ Procesados {len(reports)} reportes del PDF")
        for r in reports:
            print(f"  - {r.vehicle.name}: {len(r.entries)} entradas")
        print(f"  - Resumen actualizado con fórmulas")
    else:
        results = pipeline.run(
            max_emails=args.max_emails,
            query=args.query
        )

        print("\n" + "=" * 50)
        print("RESUMEN DE PROCESAMIENTO")
        print("=" * 50)

        total_success = sum(1 for r in results if r.success)
        total_errors = sum(len(r.errors) for r in results)
        total_warnings = sum(len(r.warnings) for r in results)

        print(f"Emails procesados: {len(results)}")
        print(f"  - Éxitos: {total_success}")
        print(f"  - Errores: {total_errors}")
        print(f"  - Advertencias: {total_warnings}")

        for result in results:
            print(f"\nEmail: {result.email_id}")
            print(f"  Attachments: {len(result.attachments)}")
            print(f"  Reports: {len(result.reports)}")
            if result.errors:
                print(f"  Errores: {result.errors}")
            if result.warnings:
                print(f"  Warnings: {result.warnings}")


if __name__ == "__main__":
    main()
