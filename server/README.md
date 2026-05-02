# Resource Synchronization Usage

Instructions for updating the internal resources (CSV files) used by the LSP server using the latest aTbRef data.

## Prerequisites

1.  **Directory Structure**: The `atbref11` repository and `tinderboxlspserver` repository must be located in the same parent directory.
2.  **aTbRef XML**: The latest `aTbRef-11.tbx` must be present in the `atbref11` directory.
3.  **Python Environment**: `poetry install` must be completed in the `atbref11` directory.
4.  **Gemini API**: If using translation features, the `gemini` CLI tool must be configured.

## Execution Steps

1.  Navigate to the `atbref11` directory.
    ```bash
    cd ../atbref11
    ```

2.  Run the synchronization script.
    ```bash
    ./sync_csvs.sh
    ```

## What it does

Executing this script automatically performs the following:
- **Extraction**: Various Python scripts extract the latest data from the `.tbx` file.
- **Translation**: `translate_csv.py` uses Gemini to translate any new entries or changes.
- **Synchronization**: The resulting CSV files are copied over to the `tinderboxlspserver/resource/` directory.
