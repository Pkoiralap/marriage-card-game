import { GameController } from './game/GameController.js';
import './utils/Toast.js'; // installs window.toast

document.addEventListener('DOMContentLoaded', () => {
    window.gameController = new GameController();
});
