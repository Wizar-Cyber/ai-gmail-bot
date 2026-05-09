"""
Ejecutar UNA VEZ localmente para generar .tokens.json con los scopes correctos.
Uso: python auth_gmail.py
"""
import json
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
]

def main():
    flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
    creds = flow.run_local_server(port=0)

    token_data = {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes),
    }

    with open(".tokens.json", "w") as f:
        json.dump(token_data, f, indent=2)

    print("\nOK: .tokens.json generado correctamente")
    print(f"  client_id : {creds.client_id[:40]}...")
    print(f"  scopes    : {list(creds.scopes)}")

if __name__ == "__main__":
    main()
