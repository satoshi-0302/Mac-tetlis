from __future__ import annotations

from dataclasses import dataclass
from random import Random
from typing import Iterable

from constants import (
    CHICK_HITBOX_RADIUS,
    CHICK_SIZE,
    GROUND_HEIGHT,
    PIPE_GAP,
    PIPE_MAX_CENTER_Y,
    PIPE_MIN_CENTER_Y,
    PIPE_SPACING,
    PIPE_SPEED,
    PIPE_SPAWN_OFFSET,
    PIPE_WIDTH,
    PLAY_HEIGHT,
    SCREEN_HEIGHT,
    SCREEN_WIDTH,
)


@dataclass
class Chick:
    x: float
    y: float
    velocity_y: float = 0.0
    rotation_deg: float = 0.0

    @property
    def hitbox_x(self) -> float:
        return self.x + CHICK_SIZE / 2

    @property
    def hitbox_y(self) -> float:
        return self.y + CHICK_SIZE / 2


@dataclass
class Pipe:
    x: float
    center_y: float
    scored: bool = False

    @property
    def gap_top(self) -> float:
        return self.center_y - PIPE_GAP / 2

    @property
    def gap_bottom(self) -> float:
        return self.center_y + PIPE_GAP / 2

    @property
    def right(self) -> float:
        return self.x + PIPE_WIDTH


class PipeField:
    def __init__(self, seed: int = 20260326):
        self._rng = Random(seed)
        self._pipes: list[Pipe] = []

    @property
    def pipes(self) -> Iterable[Pipe]:
        return self._pipes

    def reset(self) -> None:
        self._pipes.clear()
        start_x = SCREEN_WIDTH + PIPE_SPAWN_OFFSET
        for index in range(3):
            self._pipes.append(
                Pipe(x=start_x + index * PIPE_SPACING, center_y=self._next_center_y())
            )

    def update(self) -> None:
        for pipe in self._pipes:
            pipe.x -= PIPE_SPEED

        if self._pipes and self._pipes[0].right < -8:
            self._pipes.pop(0)

        if not self._pipes:
            self.reset()
            return

        while len(self._pipes) < 3:
            last_pipe = self._pipes[-1]
            self._pipes.append(
                Pipe(
                    x=last_pipe.x + PIPE_SPACING,
                    center_y=self._next_center_y(),
                )
            )

    def try_collect_score(self, chick: Chick) -> int:
        gained = 0
        for pipe in self._pipes:
            if pipe.scored:
                continue
            if pipe.right < chick.x:
                pipe.scored = True
                gained += 1
        return gained

    def collides_with(self, chick: Chick) -> bool:
        radius = CHICK_HITBOX_RADIUS
        center_x = chick.hitbox_x
        center_y = chick.hitbox_y

        if center_y - radius <= 0:
            return True
        if center_y + radius >= SCREEN_HEIGHT - GROUND_HEIGHT:
            return True

        for pipe in self._pipes:
            nearest_x = min(max(center_x, pipe.x), pipe.right)
            if center_y < pipe.gap_top:
                nearest_y = min(max(center_y, 0), pipe.gap_top)
            elif center_y > pipe.gap_bottom:
                nearest_y = min(max(center_y, pipe.gap_bottom), PLAY_HEIGHT)
            else:
                continue

            dx = center_x - nearest_x
            dy = center_y - nearest_y
            if dx * dx + dy * dy <= radius * radius:
                return True

        return False

    def _next_center_y(self) -> float:
        return self._rng.randint(PIPE_MIN_CENTER_Y, PIPE_MAX_CENTER_Y)

