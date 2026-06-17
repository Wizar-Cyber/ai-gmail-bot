#!/usr/bin/env python3
import os
import sys
import json
import base64
import webbrowser
from email.mime.text import MIMEText
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = ['https://www.googleapis.com/auth/gmail.send']
TOKEN_PATH = '.tokens_send.json'
CREDENTIALS_PATH = 'credentials.json'


def get_credentials():
    creds = None

    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH) as f:
            creds = Credentials.from_authorized_user_info(json.load(f), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_PATH):
                print(f"✗ No se encontro {CREDENTIALS_PATH}")
                print("  Debes descargar credentials.json desde Google Cloud Console")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, SCOPES)
            try:
                creds = flow.run_local_server(port=0, open_browser=False)
            except:
                print("  No se pudo abrir navegador. Usando modo manual...")
                auth_url, _ = flow.authorization_url(prompt='consent')
                print(f"\n  Abre esta URL en tu navegador:")
                print(f"\n  {auth_url}\n")
                code = input("  Pega el codigo de autorizacion aqui: ").strip()
                flow.fetch_token(code=code)
                creds = flow.credentials

        with open(TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())
        print(f"  Token guardado en {TOKEN_PATH}")

    return creds


def send_test_email(service):
    to = 'lozanoreiber1@gmail.com'
    subject = 'Prueba Bot AI Gmail - ignorar'
    body = """Hola,

Este es un correo de prueba automatico para verificar que el bot AI Gmail funciona correctamente.

Por favor verifica que:
1. El bot detecta este correo como no leido
2. El bot genera un borrador de respuesta
3. El borrador aparece en Gmail > Borradores

Gracias!
- Script de prueba
"""

    message = MIMEText(body, 'plain', 'utf-8')
    message['To'] = to
    message['Subject'] = subject

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

    result = service.users().messages().send(
        userId='me', body={'raw': raw}
    ).execute()

    print(f"  ID: {result['id']}")
    print(f"  Para: {to}")
    print(f"  Asunto: {subject}")
    return result


def main():
    print()
    print('=' * 54)
    print('  Bot AI Gmail - Envio de correo de prueba')
    print('=' * 54)
    print()

    print('  Autenticando con Gmail API...')
    creds = get_credentials()
    service = build('gmail', 'v1', credentials=creds)
    print('  Listo')
    print()

    print('  Enviando correo de prueba...')
    send_test_email(service)

    print()
    print('  Correo enviado correctamente')
    print()
    print('  Proximos pasos:')
    print('  1. Asegurate de que el bot este corriendo:')
    print('     npm run dev')
    print()
    print('  2. El bot lo detectara (polling cada 30s)')
    print('     y generara un borrador de respuesta.')
    print()
    print('  3. Revisa Gmail > Borradores.')
    print()


if __name__ == '__main__':
    main()
