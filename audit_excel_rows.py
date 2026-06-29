import pandas as pd
import sys

try:
    xl = pd.ExcelFile('forensic_jan_10_dense_final.xlsx')
    print(f'Sheets: {xl.sheet_names}')
    total_rows = 0
    for s in xl.sheet_names:
        if s != 'Summary':
            df = xl.parse(s)
            total_rows += df.shape[0]
            print(f' - {s}: {df.shape[0]} rows')
    print('Total Transaction Rows:', total_rows)
except Exception as e:
    print(f"Error: {e}")
