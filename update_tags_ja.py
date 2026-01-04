import csv

translations = {
    "^value(expression)^": "指定した式を評価して、その結果を文字列として書き出します。属性の値や、計算結果、連結された文字列などを出力する際に使用します。",
    "^action( action )^": "アクションコードを実行します。このタグ自体は何も書き出しませんが、書き出し中にノートの属性（$Colorなど）を永続的に変更したり、変数を操作したりするのに使用します。",
    "^if( condition )^": "指定された条件（アクションコード式のクエリ）を評価します。真（true）の場合、その後のコード（または^else^まで）が書き出されます。",
    "^else^": "^if^タグの条件が偽（false）だった場合に書き出すブロックを開始します。",
    "^endIf^": "^if^ブロックの終了を示します。",
    "^include( ^value(item|group)^[, ^value(template)^] )^": "指定したノート（またはノートのグループ）を、指定したテンプレート（省略時はそのノートのデフォルトテンプレート）を使用して取り込みます。",
    "^title( [item] )^": "ノートのタイトル（$Name）を書き出します。HTMLエンティティが適切に処理されます。",
    "^text( [item, N, plain] )^": "ノートの本文（$Text）を書き出します。特定の段落数(N)のみや、プレーンテキストとしての出力も可能です。",
    "^children( [template][,N] )^": "現在のノートの直下の子ノートを、指定したテンプレートで書き出します。",
    "^descendants( [template][,N] )^": "現在のノートのすべての子孫ノートを、指定したテンプレートで書き出します。",
    "^root^": "サイトのルートディレクトリへの相対パスを書き出します。画像やCSSへのパス指定に便利です。",
    "^url( item )^": "エクスポートされるHTMLページへの相対URLを書き出します。",
}

input_file = '/Users/tk4o2ka/github/tinderboxlspserver/resource/export_tags.csv'
output_file = '/Users/tk4o2ka/github/tinderboxlspserver/resource/export_tags_ja.csv'

with open(input_file, 'r', encoding='utf-8') as f_in, \
     open(output_file, 'w', encoding='utf-8', newline='') as f_out:
    reader = csv.reader(f_in)
    writer = csv.writer(f_out)
    
    header = next(reader)
    if len(header) < 3:
        header.append('DescriptionJa')
    writer.writerow(header)
    
    for row in reader:
        name = row[0]
        desc_en = row[1]
        desc_ja = translations.get(name, "")
        
        if len(row) < 3:
            row.append(desc_ja)
        else:
            row[2] = desc_ja
        writer.writerow(row)

import os
os.replace(output_file, input_file)
print("Updated export_tags.csv with Japanese descriptions.")
