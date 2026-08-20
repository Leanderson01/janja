#!/usr/bin/env python3
"""Gera os ícones do Hydra a partir da mesma geometria do `hydra-star.svg`.

Rasteriza com Pillow em vez de renderizar o SVG: não há renderizador de SVG
garantido nas máquinas do projeto, e o cálculo de pontos é o mesmo dos dois
lados — o vetor e o bitmap não podem divergir porque nascem da mesma função.
"""
import math
from PIL import Image, ImageDraw

SIZE = 1024
OUTER_RATIO = 0.42
INNER_RATIO = 0.382  # razão áurea: a proporção da estrela clássica


def star_points(cx, cy, outer, inner, n=5):
    pts = []
    for i in range(n * 2):
        r = outer if i % 2 == 0 else inner
        ang = math.radians(-90 + i * 180 / n)  # -90° põe a ponta no topo
        pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
    return pts


def render(size, supersample=8):
    """Desenha em 8× e reduz com LANCZOS — o polígono do Pillow não tem
    antialiasing, e sem isso as pontas ficam serrilhadas em 16×16."""
    s = size * supersample
    img = Image.new('RGBA', (s, s), (0, 0, 0, 255))
    ImageDraw.Draw(img).polygon(
        star_points(s / 2, s / 2, s * OUTER_RATIO, s * OUTER_RATIO * INNER_RATIO),
        fill=(255, 255, 255, 255),
    )
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    render(1024).save('brand/hydra-1024.png')
    render(512).save('build/icon.png')
    render(512).save('resources/icon.png')
    render(256).save(
        'build/icon.ico',
        format='ICO',
        sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)],
    )
    print('ícones gerados: build/icon.png, build/icon.ico, resources/icon.png, brand/hydra-1024.png')
