import Phaser from "./phaser-module.js";
import constants from "./constants.js";
import MapCharacter from "./map-character.js";
import InputNormalizer from "./input-normalizer.js";
import Butterfly from "./butterfly.js";

import { LoadedMaps } from "./preloader-scene.js";


export default class OverheadMapScene extends Phaser.Scene {

    constructor() {
        super({ key: 'OverheadMapScene' });
    }

    create(data) {
        this.cameras.main.setBackgroundColor('#a6fcdb');
        this.cameras.main.zoom = 4;

        if (!this.data.has('mapId')) {
            this.data.set('mapId', 1);
        }

        if (!this.registry.has('muted')) {
            this.registry.set('muted', false); }
        this.sound.mute = this.registry.get('muted');

        this.gamePause = false;

        this.uiScene = this.scene.get("UIScene");

        //
        // Input
        //
        this.inputNormalizer = new InputNormalizer(this.input);
        
        this.input.keyboard.on('keydown_R', () => this.scene.restart());
        //this.input.keyboard.on('keydown_G', () => this.spawnButterfly(true));
        
        this.input.keyboard.on('keydown_M', function (event) {
            this.registry.set('muted', !this.registry.get('muted'));
            this.sound.mute = this.registry.get('muted');
        }, this);
        
        this.input.keyboard.on('keydown_P', function (event) {
            var curZoom = this.cameras.main.zoom;
            this.cameras.main.zoom = {2: 4, 4: 2}[curZoom];
        }, this);

        // load the map
        this.levelLoaded = false;
        this.loadMap(this.data.get('mapId'));


        this.inputNormalizer.on("press_start", () => this.toggleSoftPause());

        //this.inputNormalizer.on("press_B", () => console.log(this.player.tilePosition));
    }

    goToNextLevel() {
        if (LoadedMaps.has(this.currentMapId + 1)) {
            this.data.set('mapId', this.currentMapId + 1);
        } else {
            this.data.set('mapId', 1);
        }
        this.scene.restart();
    }

    loadMap(mapId) {
        if (!LoadedMaps.has(mapId)) {
            console.log("that map (" + mapId + ") doesn't exist, maybe");
            return;
        }
        console.log('loading map: ' + mapId);
        this.currentMapId = mapId;

        // the tilemap
        this.map = this.make.tilemap({key: LoadedMaps.get(mapId)});
        this.tileset = this.map.addTilesetImage('tiles_i_can_actually_use', 'tiles_img', 16, 16, 1, 2);
        this.collisionLayer = this.map.createDynamicLayer('Tile Layer 1', this.tileset, 0, 0);
        this.collisionLayer.depth = 0;
        this.collisionLayer.setOrigin(0);
        this.collisionLayer.setCollision(6);

        let brace = this.add.sprite(this.map.widthInPixels / 2, this.map.heightInPixels, 'brace');
        brace.depth = -10;
        brace.setOrigin(0.5, 1);

        this.extraCollisionLayer = false;
        this.foregroundLayer = false;
        for (let layer of this.map.layers) {
            if (layer.name === "Tile Layer 2") {
                this.extraCollisionLayer = this.map.createDynamicLayer('Tile Layer 2', this.tileset, 0, 0);
                this.extraCollisionLayer.depth = 10;
                this.extraCollisionLayer.setOrigin(0);
            } else if (layer.name === "Above") {
                this.foregroundLayer = this.map.createDynamicLayer('Above', this.tileset, 0, 0);
                this.foregroundLayer.depth = 50;
                this.foregroundLayer.setOrigin(0);
            }
        }

        // lock the camera inside the map
        this.cameras.main.setBounds(0, 0, this.collisionLayer.width, this.collisionLayer.height);

        // spawn the player
        var startingTile = {x: 0, y:0};
        if (this.foregroundLayer) {
            startingTile = this.foregroundLayer.findByIndex(7);
            this.setForegroundTile(startingTile.x, startingTile.y, null);
        }
        this.player = new MapCharacter(this, 'player', startingTile.x, startingTile.y);
        this.add.existing(this.player);

        this.physics.add.existing(this.player);
        this.player.body.setCircle(4, 2, 6);

        this.butterflies = [];
        this.butterflyDelay = 3000;
        this.butterflySpawner = this.time.addEvent({delay: 1000, callback: () => this.spawnButterfly(false)});

        // Physics
        this.physics.add.collider(this.player, this.collisionLayer);

        this.cameras.main.startFollow(this.player, true);

        // Map Logic
        this.platformCoords = new Set();
        for (let j = 0; j < 3; j++) {
            for (let i = 0; i < 3; i++) {
                this.platformCoords.add((3 + i*8) + '_' + (3 + j*8));
                if (i === 1 && j === 2) {
                    this.masterPlatform = (3 + i*8) + '_' + (3 + j*8);
                }
            }
        }
        this.activePlatforms = this.platformCoords.size;

        this.bridgeBreakerDelay = 4000;
        this.bridgeBreaker = this.time.addEvent({delay: this.bridgeBreakerDelay, callback: () => this.bridgeBreakerCallback()});

        this.intensity = 1;
        this.uiScene.updateLevel(1);
        this.intensityDelay = 30000;
        this.unpausedTime = 0;

        this.levelLoaded = true;
        this.isGameOver = false;
        this.uiScene.unGameOver();
    }

    increaseIntensity() {
        this.intensity++;
        this.uiScene.updateLevel(this.intensity);

        let x = this.intensity;
        let factor = (1/Math.pow(2, x/13));
        this.bridgeBreakerDelay = 500 + factor*3500;

        this.butterflyDelay = 100 + factor*2900;

        if (this.intensity % 10 === 0) {
            this.spawnButterfly(true);
        }
    }

    bridgeBreakerCallback() {
        this.damageBridge(this.getRandomBridgeTile());
        this.bridgeBreaker = this.time.addEvent({delay: this.bridgeBreakerDelay, callback: () => this.bridgeBreakerCallback()});
    }

    spawnButterfly(gold) {
        let spawnPoint = this.randomMapEdge();
        let color = '';
        if (!gold) {
            let butterflyPool = [];
            let pushN = (val, number) => { for (let i = 0; i < number; i++) { butterflyPool.push(val); } };
            let yellows = Math.floor(this.intensity / 3) * 2;
            pushN('yellow', yellows);
            let blues = Math.floor(Math.max(this.intensity - 2, 0) / 3);
            pushN('blue', blues);
            pushN('red', 6 + blues + blues);
            //console.log([this.intensity, 'red' + 6, 'yellow' + yellows, 'blue' + blues]);
            color = Phaser.Utils.Array.GetRandom(butterflyPool);
        } else {
            color = "gold";
        }
        let b = new Butterfly(this, spawnPoint.x, spawnPoint.y, color, spawnPoint.facing);
        this.add.existing(b);
        this.butterflies.push(b);

        if (!gold) {
            this.butterflySpawner = this.time.addEvent({delay: (Math.random()*1000 - 500) + this.butterflyDelay, callback: () => this.spawnButterfly(false)});
        }
    }

    randomMapEdge() {
        let ax = Math.random() > .5 ? 'x' : 'y';
        let wx = ax === 'x' ? 'y' : 'x';
        let invert = Math.random() > .5 ? true : false;

        let coord = Math.random() * ((ax === 'x' ? this.map.widthInPixels : this.map.heightInPixels) - 20) + 10;
        let wCoord = invert ? (wx === 'x' ? this.map.widthInPixels : this.map.heightInPixels) : 0;

        let output = {facing: ax === 'x' ? (invert ? constants.DIR_UP : constants.DIR_DOWN) : (invert ? constants.DIR_LEFT : constants.DIR_RIGHT)};
        output[ax] = coord;
        output[wx] = wCoord;
        return output;
    }

    update(time, delta) {
        this.inputNormalizer.update(); // update gamepad axes
        if (!this.levelLoaded || this.gamePause) {
            return;
        }

        this.unpausedTime += delta;

        // intensity
        if (!this.isGameOver && this.unpausedTime / this.intensityDelay > this.intensity) {
            this.increaseIntensity();
        }

        let right = this.inputNormalizer.right.isDown;
        let left = this.inputNormalizer.left.isDown;
        let down = this.inputNormalizer.down.isDown;
        let up = this.inputNormalizer.up.isDown;

        
        if (this.player.state === "stationary") {
            let x = right ? 1 : (left ? -1 : 0);
            let y = down ? 1 : (up ? -1 : 0);
            let vel = this.player.body.velocity;
            if (x === 0 && y === 0) {
                vel.set(0, 0);
            } else {
                vel.set(x, y);
                vel.normalize();
                vel.set(vel.x*100, vel.y*100);
                
                if (vel.y < 0) {
                    this.player.faceDirection(constants.DIR_UP);
                } else if (vel.y > 0) {
                    this.player.faceDirection(constants.DIR_DOWN);
                } else if (vel.x > 0) {
                    this.player.faceDirection(constants.DIR_RIGHT);
                } else if (vel.x < 0) {
                    this.player.faceDirection(constants.DIR_LEFT);
                }
            }
        }

        for (let b of this.butterflies) {
            b.update(time, delta);
        }

        this.player.update(time, delta);
    }

    catchButterflies(x, y) {
        let caught = [];
        for (let b of this.butterflies) {
            if (b.overlapsCircle(x, y, 5)) {
                caught.push(b);
            }
        }
        return caught;
    }

    removeButterflies(bs) {
        this.butterflies = this.butterflies.filter((b) => !bs.includes(b));
    }

    getRandomBridgeTile() {
        let bridgeTiles = [2, 3, 4, 5];
        let allBridges = this.collisionLayer.filterTiles((tile) => bridgeTiles.includes(tile.index));
        if (allBridges.length < 1) {
            return false;
        }
        return Phaser.Utils.Array.GetRandom(allBridges);
    }

    glueBridge(tileX, tileY) {
        let curTile = this.getCollisionTileAt(tileX, tileY);
        if (curTile === 2 || curTile === 3) {
            this.setCollisionTile(tileX, tileY, curTile + 2);
            return true;
        }
        return false;
    }

    goldCaught() {
        // repair all cracked bridges
        let damagedTiles = [3, 5];
        let allDamaged = this.collisionLayer.filterTiles((tile) => damagedTiles.includes(tile.index));
        for (let tile of allDamaged) {
            this.setCollisionTile(tile.x, tile.y, tile.index - 1);
        }
    }

    damageBridge(tile) {
        if (!tile) {
            return;
        }
        let newIndex = tile.index;
        if (newIndex > 3) {
            newIndex -= 2;
        } else if (newIndex === 2) {
            newIndex = 3;
        } else {
            newIndex = 6; // break completely
        }
        this.setCollisionTile(tile.x, tile.y, newIndex);
        if (newIndex === 6) {
            this.platformCollapseCheck();
        }
    }

    playerOnGroundCheck() {
        if (this.player.state === 'falling') {
            return;
        }
        let respawnX = this.collisionLayer.tileToWorldX(11);
        let respawnY = this.collisionLayer.tileToWorldY(19);
        if (this.player.getTileNextTo(0, 0) === 6) {
            this.player.setState('falling');
            this.player.body.setVelocity(0, 0);
            this.tweens.add({
                targets: this.player,
                scaleX: 0,
                scaleY: 0,
                duration: 2000,
                onComplete: () => { 
                    this.player.setState('stationary');
                    this.player.setScale(1);
                    this.player.x = respawnX;
                    this.player.y = respawnY; 
                },
            });
        }
    }

    dropMapSection(tiles) {
        let rndStr = Math.random().toString(36).slice(2);
        let dropLayer = this.map.createBlankDynamicLayer('fall-section' + rndStr, this.tileset);
        //dropLayer.randomize(3, 3, 4, 4, [3, 2]);
        let keyCoord = (key) => { let split = key.split('_'); return {x: parseInt(split[0]), y: parseInt(split[1])}; };
        let xs = [];
        let ys = [];
        for (let tileKey of tiles.entries()) {
            let index = tileKey[1];
            let tileCoord = keyCoord(tileKey[0]);

            this.setCollisionTile(tileCoord.x, tileCoord.y, 6);
            dropLayer.putTileAt(index, tileCoord.x, tileCoord.y);

            xs.push(tileCoord.x);
            ys.push(tileCoord.y);
        }
        let sum = (arr) => arr.reduce((acc, val) => acc + val, 0);
        let avg = (arr) => Math.round(sum(arr)/arr.length);

        // I cant set the origin of a tile layer but I'll tween it's position
        // to the origin point to simulate scaling it around that point
        let targetX = this.collisionLayer.tileToWorldX(avg(xs));
        let targetY = this.collisionLayer.tileToWorldY(avg(ys));

        let posRounder = {
            _x: dropLayer.x,
            _y: dropLayer.y,
            set x (val) { this._x = val; dropLayer.x = Math.round(val); }, get x () { return this._x; },
            set y (val) { this._y = val; dropLayer.y = Math.round(val); }, get y () { return this._y; },
        };

        
        this.tweens.add({
            targets: posRounder,
            x: targetX,
            y: targetY,
            duration: 2000,
        });
        this.tweens.add({
            targets: dropLayer,
            scaleX: 0,
            scaleY: 0,
            duration: 2000,
            onComplete: () => {
                if (typeof dropLayer.layer !== "undefined") {
                    dropLayer.destroy();
                    this.sys.events.off('shutdown', dropLayer.destroy);
                } 
            },
        });

        //this.softPause();
    }

    gameOver() {
        if (this.isGameOver) {
            return;
        }
        this.bridgeBreaker.paused = true;
        console.log('game over');
        this.isGameOver = true;
        this.player.setState('gameover');
        this.uiScene.gameOver();
    }

    platformCollapseCheck() {
        let uncheckedPlatforms = [];
        for (let key of this.platformCoords) {
            if (key !== this.masterPlatform) {
                uncheckedPlatforms.push(key);
            }
        }
        if (this.activePlatforms < 2) {
            return;
        }
        let coordKey = (coord) => (coord.x + '_' + coord.y);
        let keyCoord = (key) => { let split = key.split('_'); return {x: split[0], y: split[1]}; };
        let surround_ = (x, y) => [{x: x, y: y - 1}, {x: x + 1, y: y}, {x: x, y: y + 1}, {x: x - 1, y: y}];
        let surround = (c) => surround_(parseInt(c.x), parseInt(c.y)); 

        let sanity = 0;
        while (uncheckedPlatforms.length > 0) {
            let platformsDropped = 1;
            if (sanity++ > 100000) {
                console.log('infinite loop!');
                return;
            }
            let curPlatformKey = uncheckedPlatforms.shift();
            let curPlatformCoord = keyCoord(curPlatformKey);
            let tIndex = this.getCollisionTileAt(curPlatformCoord.x, curPlatformCoord.y);
            let fill = new Map([[curPlatformKey, tIndex]]);
            let fillBorder = new Set([curPlatformKey]);

            // flood fill
            let connected = false;
            while (fillBorder.size > 0) {
                for (let curKey of fillBorder.entries()) {
                    curKey = curKey[0];
                    if (sanity++ > 100000) {
                        console.log('infinite loop!');
                        return;
                    }
                    if (curKey === this.masterPlatform) {
                        // All connected cancel the fill
                        connected = true;
                        fillBorder = new Set();
                        break;
                    }
                    if (uncheckedPlatforms.includes(curKey)) {
                        uncheckedPlatforms.splice(uncheckedPlatforms.indexOf(curKey), 1);
                        platformsDropped++;
                    }
                    let curCoord = keyCoord(curKey);
                    let surroundPos = surround(curCoord);
                    // for each surrounding tile
                    for (let sc of surroundPos) {
                        let scKey = coordKey(sc);
                        if (!fill.has(scKey)) {
                            let tIndex = this.getCollisionTileAt(sc.x, sc.y);
                            if (tIndex !== 6) {
                                fill.set(scKey, tIndex);
                                fillBorder.add(scKey);
                            }
                        }
                    }
                    fillBorder.delete(curKey);
                }
            }
            //console.log(fill.size);

            if (!connected && fill.size > 1) {
                // delete all unconnected tiles
                this.dropMapSection(fill);
                console.log('subtracting from ' + fill.size + ' ' + platformsDropped);
                this.activePlatforms -= platformsDropped;
                console.log(this.activePlatforms);
            }
        }
        this.playerOnGroundCheck();
        console.log(this.activePlatforms);
        if (this.activePlatforms < 3) {
            this.gameOver();
        }
    }

    getForegroundTileAt(tileX, tileY) {
        if (!this.foregroundLayer || tileX < 0 || tileX >= this.map.width || tileY < 0 || tileY >= this.map.height) {
            return -1;
        }
        return this.foregroundLayer.getTileAt(tileX, tileY, true).index;
    }

    getCollisionTileAt(tileX, tileY) {
        if (tileX < 0 || tileX >= this.map.width || tileY < 0 || tileY >= this.map.height) {
            console.log('checking outside of map');
            return -1;
        }
        if (this.extraCollisionLayer) {
            let t = this.extraCollisionLayer.getTileAt(tileX, tileY, true);
            if (t.index !== -1) {
                return t.index;
            }
        }
        return this.collisionLayer.getTileAt(tileX, tileY, true).index;
    }

    setCollisionTile(tileX, tileY, newTileIndex) {
        if (newTileIndex === null) {
            this.collisionLayer.removeTileAt(tileX, tileY);
        } else {
            this.collisionLayer.putTileAt(newTileIndex, tileX, tileY);
        }
    }

    setForegroundTile(tileX, tileY, newTileIndex) {
        if (newTileIndex === null) {
            this.foregroundLayer.removeTileAt(tileX, tileY);
        } else {
            this.foregroundLayer.putTileAt(newTileIndex, tileX, tileY);
        }
    }

    getTilePosFromWorldPos(worldX, worldY) {
        return new Phaser.Geom.Point(Math.floor(worldX/constants.TILE_SIZE), Math.floor(worldY/constants.TILE_SIZE));
    }

    fixBrokenKeyState() {
        for (let key of this.input.keyboard.keys) {
            if (key && key.isDown) {
                key.reset();
            }
        }
    }

    resume() {
        this.scene.wake();
        this.scene.moveBelow("UIScene");
        this.uiScene.activeScene = this;
        this.fixBrokenKeyState();
        this.gamePause = false;
    }
    softResume() {
        this.gamePause = false;
        this.bridgeBreaker.paused = false;
        this.butterflySpawner.paused = false;
        console.log('resuming');
    }
    softPause() {
        this.gamePause = true;
        this.bridgeBreaker.paused = true;
        this.butterflySpawner.paused = true;
        console.log('pausing');
    }
    toggleSoftPause() {
        if (this.gamePause) {
            this.softResume();
        } else {
            this.softPause();
        }
    }
    pause() {
        this.softPause();
        this.scene.pause();
    }
    togglePause() {
        if (this.gamePause) {
            this.resume();
        } else {
            this.pause();
        }
    }

    pauseMenu() {
        this.softPause();
        this.uiScene.showPauseMenu();
    }
}
