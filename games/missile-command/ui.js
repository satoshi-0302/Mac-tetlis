export class GameUI {
  constructor({
    onStart,
    onRetry,
    onTitle,
    onToggleAudio,
    onDemo,
    onReplay,
    onExitReplay,
    onRefreshLeaderboard,
    onNameChange,
    onCommentChange,
  }) {
    this.scoreValue = document.getElementById("scoreValue");
    this.chainValue = document.getElementById("chainValue");
    this.timeValue = document.getElementById("timeValue");
    this.citiesValue = document.getElementById("citiesValue");
    this.highScoreValue = document.getElementById("highScoreValue");
    this.mobileScoreValue = document.getElementById("mobileScoreValue");
    this.mobileHighScoreValue = document.getElementById("mobileHighScoreValue");
    this.mobileTimeValue = document.getElementById("mobileTimeValue");
    this.titleHighScore = document.getElementById("titleHighScore");
    this.statusLine = document.getElementById("statusLine");

    this.titleScreen = document.getElementById("titleScreen");
    this.resultScreen = document.getElementById("resultScreen");

    this.resultKicker = document.getElementById("resultKicker");
    this.resultTitle = document.getElementById("resultTitle");
    this.resultCopy = document.getElementById("resultCopy");
    this.resultScore = document.getElementById("resultScore");
    this.resultChain = document.getElementById("resultChain");
    this.resultCities = document.getElementById("resultCities");
    this.resultHighScore = document.getElementById("resultHighScore");
    this.audioToggle = document.getElementById("audioToggle");
    this.replayExitButton = document.getElementById("replayExitButton");
    this.demoButton = document.getElementById("demoButton");
    this.demoStatus = document.getElementById("demoStatus");
    this.playerNameInput = document.getElementById("playerName");
    this.playerCommentInput = document.getElementById("playerComment");
    this.legendPanel = document.getElementById("legendPanel");
    this.leaderboardPanel = document.getElementById("leaderboardPanel");
    this.leaderboardList = document.getElementById("leaderboardList");
    this.leaderboardStatus = document.getElementById("leaderboardStatus");
    this.refreshLeaderboard = document.getElementById("refreshLeaderboard");
    this.submitStatus = document.getElementById("submitStatus");
    this.mobilePanelsMode = null;

    this.onStart = onStart;
    this.onRetry = onRetry;
    this.onTitle = onTitle;

    document.getElementById("startButton").addEventListener("click", onStart);
    document.getElementById("retryButton").addEventListener("click", onRetry);
    document.getElementById("titleButton").addEventListener("click", onTitle);
    this.audioToggle.addEventListener("click", onToggleAudio);
    this.replayExitButton.addEventListener("click", onExitReplay);
    this.demoButton.addEventListener("click", onDemo);
    this.refreshLeaderboard.addEventListener("click", onRefreshLeaderboard);
    this.playerNameInput.addEventListener("change", (event) => onNameChange(event.target.value));
    this.playerNameInput.addEventListener("input", (event) => onNameChange(event.target.value));
    this.playerCommentInput.addEventListener("change", (event) => this.onCommentChange?.(event.target.value));
    this.playerCommentInput.addEventListener("input", (event) => this.onCommentChange?.(event.target.value));
    this.onReplay = onReplay;
    this.onCommentChange = onCommentChange;
  }

  updateHud({ score, maxChain, timeLeft, aliveCities, cityCount, highScore, state }) {
    this.scoreValue.textContent = score.toLocaleString("ja-JP");
    this.chainValue.textContent = maxChain.toLocaleString("ja-JP");
    this.timeValue.textContent = `${timeLeft.toFixed(1)}s`;
    this.citiesValue.textContent = `${aliveCities} / ${cityCount}`;
    this.highScoreValue.textContent = highScore.toLocaleString("ja-JP");
    if (this.mobileScoreValue) {
      this.mobileScoreValue.textContent = score.toLocaleString("ja-JP");
    }
    if (this.mobileHighScoreValue) {
      this.mobileHighScoreValue.textContent = highScore.toLocaleString("ja-JP");
    }
    if (this.mobileTimeValue) {
      this.mobileTimeValue.textContent = `${timeLeft.toFixed(1)}s`;
    }
    this.titleHighScore.textContent = highScore.toLocaleString("ja-JP");
    document.body.dataset.mode = state;
  }

  setAudioState({ enabled, supported }) {
    if (!supported) {
      this.audioToggle.textContent = "No Audio";
      this.audioToggle.disabled = true;
      this.audioToggle.classList.add("is-muted");
      return;
    }

    this.audioToggle.disabled = false;
    this.audioToggle.textContent = enabled ? "Sound On" : "Sound Off";
    this.audioToggle.classList.toggle("is-muted", !enabled);
  }

  setPlayerName(name) {
    this.playerNameInput.value = name;
  }

  setPlayerComment(comment) {
    this.playerCommentInput.value = comment;
  }

  setReplayState({ active }) {
    this.replayExitButton.hidden = !active;
  }

  setStatusLine(text) {
    this.statusLine.textContent = text;
  }

  syncResponsivePanels({ compact, constrainedHeight = false }) {
    const modeKey = `${compact ? "compact" : "regular"}:${constrainedHeight ? "short" : "tall"}`;
    if (this.mobilePanelsMode === modeKey) {
      return;
    }

    this.mobilePanelsMode = modeKey;
    if (compact || constrainedHeight) {
      this.legendPanel.open = true;
      this.leaderboardPanel.open = false;
      return;
    }

    this.legendPanel.open = true;
    this.leaderboardPanel.open = true;
  }

  setDemoState({ ready, label, source = "policy" }) {
    this.demoButton.disabled = !ready;
    this.demoButton.textContent = source === "heuristic" ? "Demo Play*" : "Demo Play";
    this.demoStatus.textContent = label;
  }

  setLeaderboard(board) {
    this.renderLeaderboardList(
      this.leaderboardList,
      board?.combinedEntries ?? [],
      "Leader board is still empty",
    );
  }

  setLeaderboardStatus(text, isError = false) {
    this.leaderboardStatus.textContent = text;
    this.leaderboardStatus.classList.toggle("is-error", isError);
  }

  setSubmitStatus(text) {
    this.submitStatus.hidden = !text;
    this.submitStatus.textContent = text;
  }

  renderLeaderboardList(target, entries, emptyText) {
    target.replaceChildren();

    if (!entries.length) {
      const item = document.createElement("li");
      item.className = "leaderboard-entry is-empty";
      item.textContent = emptyText;
      target.append(item);
      return;
    }

    for (const [index, entry] of entries.entries()) {
      const item = document.createElement("li");
      item.className = "leaderboard-entry";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(index + 1);

      const main = document.createElement("div");
      main.className = "leaderboard-main";

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = entry.name;

      const meta = document.createElement("span");
      meta.className = "leaderboard-meta";
      const pieces = [];
      if (entry.clear) {
        pieces.push("CLEAR");
      } else if (entry.survivingCities !== undefined) {
        pieces.push(`Cities ${entry.survivingCities}`);
      }
      pieces.push(`Chain ${entry.maxChain}`);
      if (entry.kind === "ai") {
        pieces.push("AI");
      } else if (entry.kind === "human") {
        pieces.push("Pilot");
      } else if (entry.kind === "placeholder") {
        pieces.push("Open");
      }
      meta.textContent = pieces.join(" / ");

      const comment = document.createElement("span");
      comment.className = "leaderboard-comment";
      comment.textContent = entry.comment ? `"${entry.comment}"` : "";

      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = Number(entry.score ?? 0).toLocaleString("ja-JP");

      main.append(name, meta);
      if (entry.comment) {
        main.append(comment);
      }
      item.append(rank, main, score);

      if (entry.replayAvailable) {
        const replayButton = document.createElement("button");
        replayButton.className = "secondary-button compact-button replay-button";
        replayButton.type = "button";
        replayButton.textContent = "Replay";
        replayButton.addEventListener("click", () => this.onReplay?.(entry));
        item.append(replayButton);
      }

      target.append(item);
    }
  }

  showTitle(highScore) {
    this.titleScreen.hidden = false;
    this.titleScreen.classList.add("is-visible");
    this.resultScreen.hidden = true;
    this.resultScreen.classList.remove("is-visible");
    this.titleHighScore.textContent = highScore.toLocaleString("ja-JP");
    this.setSubmitStatus("");
    this.setReplayState({ active: false });
    this.setStatusLine("タイトル画面はクリックか Enter / Space でも開始できます。");
  }

  showPlaying({ demo = false, replay = false, replayLabel = "" } = {}) {
    this.titleScreen.hidden = true;
    this.titleScreen.classList.remove("is-visible");
    this.resultScreen.hidden = true;
    this.resultScreen.classList.remove("is-visible");
    this.setReplayState({ active: replay });
    this.setStatusLine(replay ? replayLabel || "Leaderboardの replay を再生中です。" : "");
  }

  showResult(type, { score, maxChain, aliveCities, highScore, demo = false, clearBonus = 0 }) {
    const isClear = type === "clear";
    this.resultScreen.hidden = false;
    this.resultScreen.classList.add("is-visible");
    this.resultKicker.textContent = isClear ? "Mission Complete" : "Defense Lost";
    this.resultTitle.textContent = isClear ? "Clear" : "Game Over";
    this.resultCopy.textContent = isClear
      ? demo
        ? `AIデモが${aliveCities}都市を守り、地球圏バリアの展開に成功しました。${clearBonus > 0 ? ` 都市生存ボーナス +${Number(clearBonus).toLocaleString("ja-JP")}` : ""}`
        : `${aliveCities}都市を守り、地球圏バリアの展開に成功しました。${clearBonus > 0 ? ` 都市生存ボーナス +${Number(clearBonus).toLocaleString("ja-JP")}` : ""}`
      : demo
        ? "AIデモは4都市を守り切れませんでした。学習を回すと改善を試せます。"
        : "4都市すべてが破壊されました。配置を見て先回りすると立て直しやすいです。";
    this.resultScore.textContent = score.toLocaleString("ja-JP");
    this.resultChain.textContent = maxChain.toLocaleString("ja-JP");
    this.resultCities.textContent = aliveCities.toLocaleString("ja-JP");
    this.resultHighScore.textContent = highScore.toLocaleString("ja-JP");
    this.setReplayState({ active: false });
    this.setStatusLine(
      isClear
        ? "最後まで都市を残し、バリア展開が完了しました。ハイスコアも保存されています。"
        : "開始直後から複数都市をまたぐ敵を止めると、終盤がかなり安定します。",
    );
  }
}
