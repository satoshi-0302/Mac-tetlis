from __future__ import annotations

import math
from dataclasses import dataclass

import pyxel

from constants import (
    ACCENT_COLOR,
    CHICK_BEAK_COLOR,
    CHICK_BODY_COLOR,
    CHICK_EYE_COLOR,
    CHICK_SHADOW_COLOR,
    CLOUD_SCROLL_SPEED,
    FLAP_VELOCITY,
    FPS,
    GAME_VERSION,
    GRAVITY,
    GROUND_COLOR,
    GROUND_HEIGHT,
    GROUND_SCROLL_SPEED,
    GROUND_STRIPE_COLOR,
    MAX_FALL_SPEED,
    PIPE_CAP_HEIGHT,
    PIPE_COLOR,
    PIPE_SHADOW_COLOR,
    PIPE_WIDTH,
    PLAY_HEIGHT,
    READY_BOB_AMPLITUDE,
    READY_BOB_SPEED,
    ROTATION_DOWN,
    ROTATION_UP,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
    SKY_BOTTOM_COLOR,
    SKY_SCROLL_SPEED,
    SKY_TOP_COLOR,
    STAR_COLOR,
    SUN_COLOR,
    TITLE,
    START_Y,
    CHICK_X,
)
from game_logic import Chick, Pipe, PipeField


FONT_5X7 = {
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"],
    ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00100", "00100"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00001", "00001", "00001", "00001", "10001", "10001", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
}


SPRITE_SIZE = 48
SPRITE_FRAMES = ("flap_up", "flap_mid", "flap_down")


@dataclass
class Cloud:
    x: float
    y: float
    speed_scale: float


class ChickFlapApp:
    def __init__(self) -> None:
        pyxel.init(SCREEN_WIDTH, SCREEN_HEIGHT, title=TITLE, fps=FPS)
        self._sprite_pixels = self._create_sprite_frames()
        self._debug_bake_sprite_sheet()
        self.pipe_field = PipeField()
        self.stars = self._create_stars()
        self.clouds = self._create_clouds()
        self.game_state = "ready"
        self.best_score = 0
        self.reset_round()
        pyxel.run(self.update, self.draw)

    def reset_round(self) -> None:
        self.chick = Chick(x=CHICK_X, y=START_Y)
        self.pipe_field.reset()
        self.score = 0
        self.flash_timer = 0
        self.game_over_timer = 0
        self._ground_offset = 0.0
        self._sky_offset = 0.0

    def update(self) -> None:
        self._advance_parallax()
        self._advance_clouds()

        if self.game_state == "ready":
            self._update_ready()
            return

        if self.game_state == "playing":
            self._update_playing()
            return

        self._update_game_over()

    def _update_ready(self) -> None:
        self.chick.y = START_Y + math.sin(pyxel.frame_count * READY_BOB_SPEED) * READY_BOB_AMPLITUDE
        self.chick.rotation_deg = -8
        if self._is_flap_pressed():
            self.game_state = "playing"
            self.chick.velocity_y = FLAP_VELOCITY

    def _update_playing(self) -> None:
        if self._is_flap_pressed():
            self.chick.velocity_y = FLAP_VELOCITY

        self.chick.velocity_y = min(self.chick.velocity_y + GRAVITY, MAX_FALL_SPEED)
        self.chick.y += self.chick.velocity_y
        self.chick.rotation_deg = self._velocity_to_rotation(self.chick.velocity_y)

        self.pipe_field.update()
        self.score += self.pipe_field.try_collect_score(self.chick)
        self.best_score = max(self.best_score, self.score)

        if self.pipe_field.collides_with(self.chick):
            self.game_state = "game_over"
            self.game_over_timer = 0
            self.flash_timer = 10
            self.chick.velocity_y = 0

    def _update_game_over(self) -> None:
        self.game_over_timer += 1
        if self.flash_timer > 0:
            self.flash_timer -= 1
        if self.game_over_timer > 24 and self._is_flap_pressed():
            self.reset_round()
            self.game_state = "ready"

    def draw(self) -> None:
        self._draw_background()
        self._draw_pipes()
        self._draw_ground()
        self._draw_chick()
        self._draw_score()
        self._draw_overlays()

    def _draw_background(self) -> None:
        mid = int(PLAY_HEIGHT * 0.55)
        for y in range(PLAY_HEIGHT):
            color = SKY_TOP_COLOR if y < mid else SKY_BOTTOM_COLOR
            pyxel.line(0, y, SCREEN_WIDTH - 1, y, color)

        sun_x = int(SCREEN_WIDTH * 0.75)
        sun_y = int(PLAY_HEIGHT * 0.28)
        sun_r = 52
        pyxel.circ(sun_x, sun_y, sun_r, SUN_COLOR)
        for stripe in range(12):
            y = sun_y - 42 + stripe * 7
            if stripe % 2 == 0:
                pyxel.line(sun_x - 44, y, sun_x + 44, y, SKY_BOTTOM_COLOR)

        horizon_y = int(PLAY_HEIGHT * 0.8)
        pyxel.line(0, horizon_y, SCREEN_WIDTH, horizon_y, ACCENT_COLOR)
        for index in range(35):
            x = (index * 36 - int(self._sky_offset)) % (SCREEN_WIDTH + 40)
            pyxel.line(x, horizon_y, SCREEN_WIDTH // 2, PLAY_HEIGHT - 2, 5)
        for row in range(1, 10):
            y = horizon_y + row * 10
            pyxel.line(0, y, SCREEN_WIDTH, y, 1)

        for x, y in self.stars:
            twinkle = (pyxel.frame_count + x + y) % 18
            if twinkle < 12:
                pyxel.pset(x, y, STAR_COLOR)

        for cloud in self.clouds:
            self._draw_cloud(cloud)

    def _draw_cloud(self, cloud: Cloud) -> None:
        x = int(cloud.x)
        y = int(cloud.y)
        pyxel.circ(x, y, 16, 7)
        pyxel.circ(x + 18, y - 5, 13, 7)
        pyxel.circ(x - 17, y + 2, 12, 7)
        pyxel.rect(x - 22, y, 42, 12, 7)

    def _draw_pipes(self) -> None:
        for pipe in self.pipe_field.pipes:
            self._draw_pipe_segment(pipe)

    def _draw_pipe_segment(self, pipe: Pipe) -> None:
        top_height = int(pipe.gap_top)
        bottom_y = int(pipe.gap_bottom)
        bottom_height = PLAY_HEIGHT - bottom_y
        x = int(pipe.x)

        self._draw_pipe_body(x, 0, top_height)
        self._draw_pipe_cap(x - 6, top_height - PIPE_CAP_HEIGHT, PIPE_WIDTH + 12)

        self._draw_pipe_body(x, bottom_y, bottom_height)
        self._draw_pipe_cap(x - 6, bottom_y, PIPE_WIDTH + 12)

    def _draw_pipe_body(self, x: int, y: int, height: int) -> None:
        if height <= 0:
            return
        pyxel.rect(x, y, PIPE_WIDTH, height, PIPE_COLOR)
        pyxel.rect(x + PIPE_WIDTH - 12, y, 12, height, PIPE_SHADOW_COLOR)
        pyxel.line(x + 10, y, x + 10, y + height - 1, 7)

    def _draw_pipe_cap(self, x: int, y: int, width: int) -> None:
        pyxel.rect(x, y, width, PIPE_CAP_HEIGHT, PIPE_COLOR)
        pyxel.rect(x + width - 12, y, 12, PIPE_CAP_HEIGHT, PIPE_SHADOW_COLOR)
        pyxel.line(x + 10, y + 2, x + 10, y + PIPE_CAP_HEIGHT - 3, 7)

    def _draw_ground(self) -> None:
        ground_y = PLAY_HEIGHT
        pyxel.rect(0, ground_y, SCREEN_WIDTH, GROUND_HEIGHT, GROUND_COLOR)
        for stripe in range(0, SCREEN_WIDTH + 32, 32):
            x = (stripe - int(self._ground_offset)) % (SCREEN_WIDTH + 32) - 32
            pyxel.rect(x, ground_y + 8, 20, 16, GROUND_STRIPE_COLOR)
        pyxel.line(0, ground_y, SCREEN_WIDTH, ground_y, 7)

    def _draw_chick(self) -> None:
        frame = self._pick_chick_frame()
        angle_deg = self._pick_chick_angle()
        self._draw_rotated_sprite(int(self.chick.x), int(self.chick.y), self._sprite_pixels[frame], angle_deg)

    def _pick_chick_frame(self) -> str:
        tick = (pyxel.frame_count // 5) % 3
        if self.game_state == "ready":
            return ("flap_mid", "flap_up", "flap_mid")[tick]
        if self.game_state == "game_over":
            return ("flap_down", "flap_mid", "flap_down")[tick]
        if self.chick.velocity_y < -1.0:
            return SPRITE_FRAMES[tick]
        if self.chick.velocity_y > 3.5:
            return ("flap_down", "flap_mid", "flap_down")[tick]
        return ("flap_mid", "flap_up", "flap_mid")[tick]

    def _pick_chick_angle(self) -> float:
        if self.game_state == "ready":
            return -8
        if self.game_state == "game_over":
            return min(85, 45 + self.game_over_timer * 2)

        vy = self.chick.velocity_y
        if vy < -5.0:
            return -58
        if vy < -2.0:
            return -38
        if vy < 1.2:
            return -10
        if vy < 4.2:
            return 25
        if vy < 6.8:
            return 50
        return 82

    def _draw_rotated_sprite(self, x: int, y: int, sprite: list[list[int]], angle_deg: float) -> None:
        size = len(sprite)
        center = (size - 1) / 2
        rad = math.radians(angle_deg)
        cos_v = math.cos(rad)
        sin_v = math.sin(rad)
        for sy in range(size):
            for sx in range(size):
                color = sprite[sy][sx]
                if color == 0:
                    continue
                dx = sx - center
                dy = sy - center
                rx = dx * cos_v - dy * sin_v
                ry = dx * sin_v + dy * cos_v
                tx = int(round(x + center + rx))
                ty = int(round(y + center + ry))
                pyxel.pset(tx, ty, color)

    def _create_sprite_frames(self) -> dict[str, list[list[int]]]:
        wing_mode = {
            "flap_up": "up",
            "flap_mid": "mid",
            "flap_down": "down",
        }
        return {name: self._build_chick_sprite(wing_mode[name]) for name in SPRITE_FRAMES}

    def _build_chick_sprite(self, wing: str) -> list[list[int]]:
        pixels = [[0 for _ in range(SPRITE_SIZE)] for _ in range(SPRITE_SIZE)]

        def pset(px: int, py: int, color: int) -> None:
            if 0 <= px < SPRITE_SIZE and 0 <= py < SPRITE_SIZE:
                pixels[py][px] = color

        def fill_ellipse(cx: int, cy: int, rx: int, ry: int, color: int) -> None:
            for yy in range(cy - ry, cy + ry + 1):
                for xx in range(cx - rx, cx + rx + 1):
                    dx = xx - cx
                    dy = yy - cy
                    if (dx * dx) * (ry * ry) + (dy * dy) * (rx * rx) <= (rx * rx) * (ry * ry):
                        pset(xx, yy, color)

        def fill_triangle(a: tuple[int, int], b: tuple[int, int], c: tuple[int, int], color: int) -> None:
            min_x = max(min(a[0], b[0], c[0]), 0)
            max_x = min(max(a[0], b[0], c[0]), SPRITE_SIZE - 1)
            min_y = max(min(a[1], b[1], c[1]), 0)
            max_y = min(max(a[1], b[1], c[1]), SPRITE_SIZE - 1)
            denom = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if denom == 0:
                return
            for yy in range(min_y, max_y + 1):
                for xx in range(min_x, max_x + 1):
                    w1 = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / denom
                    w2 = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / denom
                    w3 = 1 - w1 - w2
                    if w1 >= 0 and w2 >= 0 and w3 >= 0:
                        pset(xx, yy, color)

        body_cx, body_cy = 21, 30
        head_cx, head_cy = 29, 16

        fill_ellipse(body_cx, body_cy, 15, 13, CHICK_BODY_COLOR)
        fill_ellipse(body_cx - 4, body_cy + 2, 11, 10, CHICK_SHADOW_COLOR)
        fill_ellipse(body_cx + 6, body_cy + 4, 8, 6, CHICK_BODY_COLOR)
        fill_ellipse(head_cx, head_cy, 12, 10, CHICK_BODY_COLOR)
        fill_ellipse(head_cx + 2, head_cy - 1, 10, 8, CHICK_BODY_COLOR)

        if wing == "up":
            fill_ellipse(body_cx - 14, body_cy - 8, 7, 12, 9)
            fill_ellipse(body_cx - 10, body_cy - 12, 5, 7, 10)
        elif wing == "mid":
            fill_ellipse(body_cx - 15, body_cy - 2, 9, 9, 9)
            fill_ellipse(body_cx - 11, body_cy - 4, 6, 6, 10)
        else:
            fill_ellipse(body_cx - 14, body_cy + 9, 7, 12, 9)
            fill_ellipse(body_cx - 10, body_cy + 12, 5, 7, 10)

        fill_triangle((39, 17), (47, 20), (39, 25), CHICK_BEAK_COLOR)
        fill_triangle((43, 19), (47, 20), (43, 23), 9)
        fill_triangle((39, 21), (45, 22), (39, 26), CHICK_BEAK_COLOR)

        fill_ellipse(26, 14, 4, 4, 7)
        fill_ellipse(33, 14, 4, 4, 7)
        fill_ellipse(27, 15, 2, 2, CHICK_EYE_COLOR)
        fill_ellipse(34, 15, 2, 2, CHICK_EYE_COLOR)
        pset(24, 11, 7)
        pset(31, 10, 7)

        fill_ellipse(22, 21, 3, 2, 8)
        fill_ellipse(36, 22, 3, 2, 8)

        pset(28, 4, 8)
        pset(30, 2, 8)
        pset(32, 1, 8)
        pset(34, 3, 8)

        fill_ellipse(18, 43, 2, 1, 8)
        fill_ellipse(26, 43, 2, 1, 8)
        pset(16, 44, 8)
        pset(20, 44, 8)
        pset(24, 44, 8)
        pset(28, 44, 8)

        pset(5, 28, 14)
        pset(4, 29, 14)
        pset(3, 30, 14)
        pset(2, 31, 14)
        pset(1, 32, 14)

        return pixels

    def _debug_bake_sprite_sheet(self) -> None:
        image = pyxel.image(0)
        for index, name in enumerate(SPRITE_FRAMES):
            rows = ["".join(f"{px:x}" for px in row) for row in self._sprite_pixels[name]]
            image.set(index * SPRITE_SIZE, 0, rows)

    def _draw_score(self) -> None:
        score_text = str(self.score)
        scale = 4
        width = self._measure_hires_text(score_text, scale)
        x = SCREEN_WIDTH // 2 - width // 2
        self._shadow_text_hires(x, 28, score_text, 7, scale)

    def _draw_overlays(self) -> None:
        if self.game_state == "ready":
            self._shadow_text_hires(140, 96, "TAP TO FLAP", 7, 2)
            self._shadow_text_hires(112, 128, "SPACE / CLICK / TAP", 10, 2)
            self._shadow_text_hires(148, 378, "PASS THE PIPES", 7, 2)
            self._shadow_text_hires(132, 404, "HIT GROUND = OUT", 7, 2)

        if self.game_state == "game_over":
            self._shadow_text_hires(176, 110, "GAME OVER", 8, 3)
            self._shadow_text_hires(188, 160, f"SCORE {self.score}", 7, 2)
            self._shadow_text_hires(182, 188, f"BEST {self.best_score}", 10, 2)
            self._shadow_text_hires(150, 242, "PRESS TO RESTART", 7, 2)

        self._shadow_text_hires(16, 16, TITLE.upper(), 7, 2)
        self._shadow_text_hires(16, SCREEN_HEIGHT - 30, GAME_VERSION.upper(), 13, 1)

        if self.flash_timer > 0 and self.flash_timer % 2 == 0:
            pyxel.rect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, 7)

    def _draw_hires_text(self, x: int, y: int, text: str, color: int, scale: int = 2) -> None:
        cursor_x = x
        for char in text.upper():
            glyph = FONT_5X7.get(char, FONT_5X7[" "])
            for gy, row in enumerate(glyph):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        pyxel.rect(
                            cursor_x + gx * scale,
                            y + gy * scale,
                            scale,
                            scale,
                            color,
                        )
            cursor_x += 6 * scale

    def _measure_hires_text(self, text: str, scale: int) -> int:
        if not text:
            return 0
        return len(text) * 6 * scale - scale

    def _shadow_text_hires(self, x: int, y: int, text: str, color: int, scale: int = 2) -> None:
        self._draw_hires_text(x + scale // 2, y + scale // 2, text, 0, scale)
        self._draw_hires_text(x, y, text, color, scale)

    def _advance_parallax(self) -> None:
        if self.game_state != "game_over":
            self._ground_offset = (self._ground_offset + GROUND_SCROLL_SPEED) % 32
            self._sky_offset = (self._sky_offset + SKY_SCROLL_SPEED) % (SCREEN_WIDTH + 40)

    def _advance_clouds(self) -> None:
        if self.game_state == "game_over":
            return
        for cloud in self.clouds:
            cloud.x -= CLOUD_SCROLL_SPEED * cloud.speed_scale
            if cloud.x < -50:
                cloud.x = SCREEN_WIDTH + 50

    def _is_flap_pressed(self) -> bool:
        return (
            pyxel.btnp(pyxel.KEY_SPACE)
            or pyxel.btnp(pyxel.KEY_UP)
            or pyxel.btnp(pyxel.MOUSE_BUTTON_LEFT)
            or pyxel.btnp(pyxel.GAMEPAD1_BUTTON_A)
        )

    def _velocity_to_rotation(self, velocity_y: float) -> float:
        if velocity_y <= 0:
            return ROTATION_UP
        ratio = min(velocity_y / MAX_FALL_SPEED, 1.0)
        return ROTATION_UP + (ROTATION_DOWN - ROTATION_UP) * ratio

    def _create_stars(self) -> list[tuple[int, int]]:
        return [
            (36, 42),
            (84, 56),
            (126, 30),
            (208, 52),
            (256, 30),
            (316, 64),
            (376, 42),
            (420, 28),
            (502, 48),
            (580, 36),
        ]

    def _create_clouds(self) -> list[Cloud]:
        return [
            Cloud(x=100, y=138, speed_scale=0.8),
            Cloud(x=320, y=176, speed_scale=1.0),
            Cloud(x=560, y=132, speed_scale=0.7),
        ]


if __name__ == "__main__":
    ChickFlapApp()
