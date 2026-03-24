#!/usr/bin/env python3
"""
dist.html を生成するビルドスクリプト。
index.html に style.css と game.js をインライン結合した
単一ファイルを作成します。
"""
with open('index.html', encoding='utf-8') as f:
    html = f.read()
with open('style.css', encoding='utf-8') as f:
    css = f.read()
with open('game.js', encoding='utf-8') as f:
    js = f.read()

html = html.replace(
    '<link rel="stylesheet" href="style.css">',
    f'<style>\n{css}\n</style>'
)
html = html.replace(
    '<script src="game.js"></script>',
    f'<script>\n{js}\n</script>'
)

with open('dist.html', 'w', encoding='utf-8') as f:
    f.write(html)

print('dist.html を生成しました')
