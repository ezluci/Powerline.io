const WebSocket = require('ws');
const HttpsServer = require('https').createServer;
const fs = require("fs");
const EventEmitter = require("events");
const { time } = require('console');


let server, wssSecure

if (fs.existsSync("C:\\Certbot\\live\\dalr.ae\\cert.pem")) {
    let cert = fs.realpathSync("C:\\Certbot\\live\\dalr.ae\\cert.pem")
    let key = fs.realpathSync("C:\\Certbot\\live\\dalr.ae\\privkey.pem")
    let chain = fs.realpathSync("C:\\Certbot\\live\\dalr.ae\\fullchain.pem")
    server = HttpsServer({
        cert: fs.readFileSync(cert),
        key: fs.readFileSync(key)
    })
    wssSecure = new WebSocket.Server({ server: server });
    server.listen(1338);
    
}
var admins = [
    "73.96.77.58",
    "127.0.0.1",
    "64.112.210.252"
]
const wss = new WebSocket.Server({ port: 1337});
var snakes = {}
var entities = {}
var clients = {}
var lastClientId = 1
var lastEntityId = 1
var arenaSize = 300
var updateDuration = 90
var UPDATE_EVERY_N_TICKS = 3;
let maxBoostSpeed = 255;
let maxRubSpeed = 200;
var foodValue = 1.5;
var scoreMultiplier = 10/foodValue;
var defaultLength = 10;
var king = null;
var lastUpdate = 0;
let maxFood = arenaSize * 5;
let foodSpawnPercent = (arenaSize ^ 2) / 10;
var foodMultiplier = 1;

function lineSegmentsIntersect(line1Start, line1End, line2Start, line2End) {
    const det = (line1End.x - line1Start.x) * (line2End.y - line2Start.y) - (line2End.x - line2Start.x) * (line1End.y - line1Start.y);
    if (det === 0) return false;

    const lambda = ((line2End.y - line2Start.y) * (line2End.x - line1Start.x) + (line2Start.x - line2End.x) * (line2End.y - line1Start.y)) / det;
    const gamma = ((line1Start.y - line1End.y) * (line2End.x - line1Start.x) + (line1End.x - line1Start.x) * (line2End.y - line1Start.y)) / det;

    return (0 < lambda && lambda < 1) && (0 < gamma && gamma < 1);
}

function pointInsideRectangle(point, rectangle) {
    return point.x >= rectangle.x &&
        point.x <= rectangle.x + rectangle.width &&
        point.y >= rectangle.y &&
        point.y <= rectangle.y + rectangle.height;
}

function lineInsideOrIntersectsRectangle(lineStart, lineEnd, center, width, height) {
    const rectangle = {
        x: center.x - width / 2,
        y: center.y - height / 2,
        width: width,
        height: height
    };

    if (pointInsideRectangle(lineStart, rectangle) || pointInsideRectangle(lineEnd, rectangle)) return true;

    const rectangleEdges = [
        [[rectangle.x, rectangle.y], [rectangle.x + rectangle.width, rectangle.y]],
        [[rectangle.x + rectangle.width, rectangle.y], [rectangle.x + rectangle.width, rectangle.y + rectangle.height]],
        [[rectangle.x, rectangle.y + rectangle.height], [rectangle.x + rectangle.width, rectangle.y + rectangle.height]],
        [[rectangle.x, rectangle.y], [rectangle.x, rectangle.y + rectangle.height]]
    ];

    for (const edge of rectangleEdges) {
        if (lineSegmentsIntersect(lineStart, lineEnd, { x: edge[0][0], y: edge[0][1] }, { x: edge[1][0], y: edge[1][1] })) return true;
    }

    return false;
}

function entitiesWithinRadius(center, entities, checksnake) {
    const windowSizeX = checksnake.windowSizeX;
    const windowSizeY = checksnake.windowSizeY;
    const xMin = center.x - windowSizeX / 2;
    const xMax = center.x + windowSizeX / 2;
    const yMin = center.y - windowSizeY / 2;
    const yMax = center.y + windowSizeY / 2;

    const foundEntities = [];

    entities.forEach(entity => {
        let intersectsRectangle = false;

        switch (entity.type) {
            case EntityTypes.Player:
                if (entity.spawned) {
                    for (let i = -1; i < entity.points.length - 1; i++) {
                        const point = (i === -1) ? entity.position : entity.points[i];
                        const nextPoint = entity.points[i + 1];
                        if (lineInsideOrIntersectsRectangle(point, nextPoint, center, windowSizeX, windowSizeY)) {
                            intersectsRectangle = true;
                            break;
                        }
                    }
                }
                break;
            case EntityTypes.Item:
                if (pointInsideRectangle(entity.position, { x: xMin, y: yMin, width: windowSizeX, height: windowSizeY })) {
                    intersectsRectangle = true;
                }
                break;
        }

        if (intersectsRectangle) {
            foundEntities.push(entity);
        }
    });

    return foundEntities;
}

function pointsNearSnake(player1, player2, distance) {
    let width = distance;
    let height = distance;
    let foundPoints = [];
    let lastPointFound = false
    let center = player1.position
    let points = player2.points
    for (let i = -1; i < points.length - 1; i++) {
        let point = points[i];
        let nextPoint = points[i + 1];
        if (i == -1)
            point = player2.position
        if (!nextPoint)
            break
        if (lineInsideOrIntersectsRectangle(point, nextPoint, center, width, height)) {
            if (!lastPointFound) {
                foundPoints.push({
                    index: i,
                    point: point
                });
            }
            foundPoints.push({
                index: i + 1,
                point: nextPoint
            });
            lastPointFound = true
        }
        else {
            lastPointFound = false
        }
    }
    return foundPoints
}

function getScoreToDrop(length) {
    let score = (length - defaultLength)*scoreMultiplier
    let x = Math.ceil(Math.random() * 30 * 10) / 10
    return Math.floor(((score - (score - x) / 6) + 70) / 10) * 10
}

function scoreToFood(score) {
    return Math.floor(score / 10)
}
function lengthToScore(length) {
    return (length - defaultLength)*scoreMultiplier
}
function scoreToLength(score) {
    return score/scoreMultiplier


}

const MessageTypes = Object.freeze({
    // Server Messages
    SendPingInfo: 0,
    PingLoop: 1,
    SendConfig: 160,
    SendSpawn: 161,
    SendEntities: 163,
    SendEvent: 164,
    SendLeaderboard: 165,
    SendConfigWithMinimapOffset: 176,
    // Client Messages
    RecievePing: 0,
    RecieveNick: 3,
    RecieveLeave: 4,
    RecieveDirection: 5,
    RecieveTurnPoint: 6,
    RecieveResize: 7,
    RecieveBoost: 8,
    RecieveDebugFoodGrab: 9,
    RecieveBigPicture: 11,
    RecieveTalk: 12,
    RecievePong: 16,
    RecieveDebugHello: 0xab,
    RecieveHello: 0xbf,
})
const EventTypes = Object.freeze({
    Kill: 1,
    Killed: 2
})
const UpdateTypes = Object.freeze({
    OnUpdate: 0,
    OnRender: 1,
    OnRemove: 2
})

const EntityTypes = Object.freeze({
    Collider: 1,
    Item: 4,
    Player: 5
})
const EntitySubtypes = Object.freeze({
    Food: 0,
    Energy: 1,
    TriPlus: 2,
    TriMinus: 3,


})


const EntityFlags = Object.freeze({
    Debug: 1,
    IsRubbing: 2,
    Boosting: 4,
    Ping: 8,
    KilledKing: 0x10,
    Killstreak: 0x20,
    ShowTalking: 0x40
})

const KillReasons = Object.freeze({
    LeftScreen: 0,
    Killed: 1,
    Boundary: 2,
    Self: 3,
})

const Directions = Object.freeze({
    None: 0,
    Up: 1,
    Left: 2,
    Down: 3,
    Right: 4
})


class Food {
    type = EntityTypes.Item;
    subtype = EntitySubtypes.Food;
    position = { x: 0, y: 0 };
    spawned = true
    value = foodValue*2;
    lastUpdate = Date.now();
  constructor(x, y, color, origin, timeToLive = 5000+(Math.random()*60*1000*5)) {
    entities[lastEntityId] = this;
    if (x == undefined) 
          this.position = GetRandomPosition();
    else {
        this.position = { x: x, y: y };
    }
    if (color == undefined) this.color = Math.random() * 360;
    else this.color = color;
      this.id = lastEntityId;
    if (origin)
        this.origin = origin.id;
    lastEntityId++;
      setTimeout(() => {
          this.eat();
      }, timeToLive);
    return this;
    }
    
    eat(snake) {
        this.lastUpdate = Date.now();
        this.spawned = false
        if (snake && this.origin == snake.id) {
            return;
        }
        if (snake) {
            for (let i = 0; i < 3; i++) {
                setTimeout(() => {
                    snake.extraSpeed += 2;
                    if (snake.extraSpeed > maxBoostSpeed && !snake.speedBypass)
                        snake.extraSpeed = maxBoostSpeed;
                }, updateDuration * 2 * i)
            }
        }
        
        Object.values(clients).forEach((snakee) => {
            if (snakee.id) {
                if (snakee.loadedEntities[this.id]) {
                    var Bit8 = new DataView(new ArrayBuffer(16 + 2 * 1000));
                    Bit8.setUint8(0, MessageTypes.SendEntities);
                    var offset = 1;
                    Bit8.setUint16(offset, this.id, true);
                    offset += 2;
                    Bit8.setUint8(offset, UpdateTypes.OnRemove, true);
                    offset += 1;
                    Bit8.setUint16(offset, snake && snake.id || 0, true);
                    offset += 2;
                    Bit8.setUint8(offset, KillReasons.Killed, true);
                    offset += 1;

                    // King
                    Bit8.setUint16(offset, 0, true);
                    offset += 2;
                    Bit8.setUint16(offset, king && king.id || 0, true);
                    offset += 2;
                    Bit8.setFloat32(offset, king && king.position.x || 0, true);
                    offset += 4;
                    Bit8.setFloat32(offset, king && king.position.y || 0, true);
                    offset += 4;
                    
                    snakee.network.send(Bit8);
                    delete snakee.loadedEntities[this.id]
                }
            }
        })
        if (snake) {
            snake.length += this.value;
            snake.lastAte = Date.now();
        }
        delete entities[this.id]; 
    }
}

for (let i = 0; i < maxFood; i++) {
//for (let i = 0; i < 1000; i++) {
    new Food();
}


function GetRandomPosition() {
    return { x: Math.random() * arenaSize - arenaSize / 2, y: Math.random() * arenaSize - arenaSize / 2 };
}


class Snake {
    network = null;
    nick = "";
    type = EntityTypes.Player;
    loadedEntities = {};
    
    constructor(network, simulated) {
        this.network = network.socket;
        this.ip = network.ip;
        this.simulated = simulated;
        this.sendConfig();

        if (!this.id) {
          clients[lastClientId] = this;
          lastClientId++;
        }
    }
    windowSizeX = 128;
    windowSizeY = 64;
    sendConfig() {
        var Bit8 = new DataView(new ArrayBuffer(49));
        let cfgType = MessageTypes.SendConfig;
        let offset = 0;
        Bit8.setUint8(offset, cfgType); // 176 or 160
        offset += 1;
        Bit8.setFloat32(offset, arenaSize, true); //Arena Size
        offset += 4;
        if (cfgType == MessageTypes.SendConfigWithMinimapOffset) {
            Bit8.setFloat32(offset, 0, true); //Minimap Entities X Offset
            offset += 4;
            Bit8.setFloat32(offset, 0, true); //Minimap Entities Y Offset
            offset += 4;
        }
        Bit8.setFloat32(offset, 2, true); //Default zoom
        offset += 4;
        Bit8.setFloat32(offset, 1.5, true); //Minimum zoom
        offset += 4;
        Bit8.setFloat32(offset, 100, true); //Minimum zoom score
        offset += 4;
        Bit8.setFloat32(offset, 10, true); //Zoom Level 2
        offset += 4 + 4;
        Bit8.setFloat32(offset, 90, true); //Input Delay, If 0 then no input delay calculations will take place
        offset += 4;
        Bit8.setFloat32(offset, 60, true); //Not Used
        offset += 4;
        Bit8.setFloat32(offset, 40, true); //Other Snake Delay
        offset += 4;
        Bit8.setFloat32(offset, 1, true); //isTalkEnabled
        this.network.send(Bit8);

        
    }
    spawn(name) {
        this.spawned = true;
        var Bit8 = new DataView(new ArrayBuffer(1000));
        Bit8.setUint8(0, MessageTypes.SendSpawn);
        Bit8.setUint32(1, lastEntityId, true);
        this.id = lastEntityId;
        this.nick = name
        let randomPos = GetRandomPosition();
        this.position = { x: randomPos.x, y: randomPos.y };
        this.direction = Directions.Up;
        this.speed = 0.25;
        this.speedBypass = false;
        this.extraSpeed = 0;
        this.killstreak = 0;
        this.points = [{x: this.position.x, y: this.position.y}];
        this.newPoints = [];
        this.talkStamina = 255;
        this.color = Math.random() * 360;
        this.length = defaultLength;



        lastEntityId++;
        snakes[this.id] = this;
        entities[this.id] = this;

        
        this.network.send(Bit8);

        
    }

    updateLeaderboard() {
        const snakesArray = Object.values(snakes);
        // Sort snakesArray based on length in descending order
        snakesArray.sort((a, b) => b.length - a.length);
        
        const numSnakes = snakesArray.length;
        const maxNickLength = Math.max(...snakesArray.map(snake => snake.nick.length));

        // Calculate total bits needed
        const totalBits = 7 + numSnakes * (8 + maxNickLength * 2); // Inline snakeDataSize calculation

        // Create the bit buffer
        const bitBuffer = new ArrayBuffer(totalBits);
        const bitView = new DataView(bitBuffer);

        // Write message type
        bitView.setUint8(0, MessageTypes.SendLeaderboard);
        let offset = 1;

        // Write snake data
        for (let i = 0; i < Math.min(numSnakes, 10); i++) {
            const snake = snakesArray[i];
            const rank = i + 1;
            snake.rank = rank;

            // Write snake data
            bitView.setUint16(offset, snake.id, true);
            bitView.setUint32(offset + 2, (snake.length - defaultLength) * scoreMultiplier, true);

            // Write snake name
            const nameBytes = new TextEncoder().encode(snake.nick);
            for (let j = 0; j < nameBytes.length; j++) {
                bitView.setUint16(offset + 6 + j * 2, nameBytes[j], true);
            }

            // Null-terminate snake name
            bitView.setUint16(offset + 6 + nameBytes.length * 2, 0, true);

            offset += 8 + nameBytes.length * 2; // Update offset
        }

        // Write current snake's data
        bitView.setUint16(offset, 0, true); // Null-terminate snake data
        offset += 2;
        bitView.setUint16(offset, this.id, true);
        offset += 2;
        const mySnake = snakes[this.id];
        if (mySnake) {
            bitView.setUint32(offset, (mySnake.length - defaultLength) * scoreMultiplier, true);
            offset += 4;
            const myRank = mySnake.rank || 0;
            bitView.setUint16(offset, myRank, true);
        }

        // Send the bit buffer
        this.network.send(bitBuffer);
    }
    addPoint(x, y) {
        this.points.unshift({ x: x, y: y });
        this.newPoints.push({ x: x, y: y });
    }
    turn(direction, vector) {
        let whatVector, oppositeVector;
        if (direction == Directions.Up || direction == Directions.Down) {
            whatVector = "x";
            oppositeVector = "y";
        } else {
            whatVector = "y";
            oppositeVector = "x";
        }
        if (this.direction == direction || this.direction + 2 == direction || this.direction - 2 == direction) { // If the direction is the same or opposite
            return;
        }
        let goingUp = this.direction = Directions.Up || this.direction == Directions.Right;
        if (this.position[whatVector] == vector) { // Attempting to turn in place
            //console.log("Attempting to turn in place")
            if (goingUp) {
                this.position[whatVector] += 0.1;
            }
            else {
                this.position[whatVector] -= 0.1;
            }
        } else {
            let dist = Math.abs(this.position[whatVector] - vector);
            if (dist > 5) {
                //console.log("Attempting to turn "+dist+" units away")
                
                let goingUp = this.direction = Directions.Up || this.direction == Directions.Right;
                if (goingUp) {
                    this.position[whatVector] += 0.1;
                }
                else {
                    this.position[whatVector] -= 0.1;
                }
            } else
                this.position[whatVector] = vector;

        }

        

        let secondPoint = this.points[0];
        

        if (secondPoint)
            Object.values(clients).forEach((snake) => {
                if (this.loadedEntities[snake.id]) {
                    let nearbyPoints = pointsNearSnake(this, snake, 30);
                    for (let i = 0; i < nearbyPoints.length - 1; i++) {
                        let point, nextPoint;
                        point = nearbyPoints[i];
                        nextPoint = nearbyPoints[i + 1];
                        if (nextPoint.index != point.index + 1)
                            continue
                        point = point.point;
                        nextPoint = nextPoint.point;
                        
                        // Make sure that the last point did not intersect with another snake
                        if (this.position != nextPoint && secondPoint != point && secondPoint != nextPoint &&
                            this.position != secondPoint && this.position != point) {
                            
                            if (doIntersect(this.position, secondPoint, point, nextPoint)) {
                                /*this.DrawDebugCircle(this.position.x, this.position.y, 50, 4); // Yellow
                                this.DrawDebugCircle(secondPoint.x, secondPoint.y, 50, 4); // Yellow
                                this.DrawDebugCircle(point.x, point.y, 100, 3); // Green
                                this.DrawDebugCircle(nextPoint.x, nextPoint.y, 100, 3); // Green*/
                                setTimeout(() => { // Make sure they didn't move out of the way
                                    if (doIntersect(this.position, secondPoint, point, nextPoint)) {
                                        if (this == snake) {
                                            this.kill(KillReasons.Self, this.id);
                                        } else {
                                            this.kill(KillReasons.Killed, snake.id);
                                        }
                                    }
                                }, snake.ping || 50)
                            }
                        }
                    }
                }
        })
        
            


        
        this.direction = direction;
        this.addPoint(this.position.x, this.position.y);
    }
    rubAgainst(snake, distance) {
        this.flags |= EntityFlags.IsRubbing;
        this.speeding = true
        this.RubSnake = snake.id;

        let rubSpeed = 4/distance
        if (rubSpeed > 4)
            rubSpeed = 4
        if (this.extraSpeed + rubSpeed <= maxRubSpeed || this.speedBypass) {
            this.extraSpeed += rubSpeed
            this.speed = 0.25 + this.extraSpeed / (255 * UPDATE_EVERY_N_TICKS);
        }
        
    }
    stopRubbing() {
        this.flags &= ~EntityFlags.IsRubbing;
        this.speeding = false
    }
    kill(reason, killedByID) {
        if (this.invincible)
            return;
        if (killedByID != this.id) {
            if (!snakes[killedByID])
                return
            //
            snakes[killedByID].killstreak += 1;
            if (snakes[killedByID].killstreak >= 8) {
                snakes[killedByID].flags |= EntityFlags.Killstreak;
                let oldKillstreak = snakes[killedByID].killstreak;
                setTimeout(() => {
                    if (!snakes[killedByID])
                        return
                    if (snakes[killedByID].killstreak == oldKillstreak)
                        snakes[killedByID].flags &= ~EntityFlags.Killstreak;
                }, 5000)
            }
            if (king && king == this) {
                snakes[killedByID].flags |= EntityFlags.KilledKing;
                setTimeout(() => {
                    if (!snakes[killedByID])
                        return
                    snakes[killedByID].flags &= ~EntityFlags.KilledKing;
                }, 5000)
            }

            // Send "Killed"
            var Bit8 = new DataView(new ArrayBuffer(16 + 2 * 1000));
            Bit8.setUint8(0, MessageTypes.SendEvent);
            var offset = 1;
            Bit8.setUint8(offset, EventTypes.Kill, true);
            offset += 1;
            Bit8.setUint16(offset, 0, true); //(ID?), unused.
            offset += 2;
            for (
              var characterIndex = 0;
              characterIndex < this.nick.length;
              characterIndex++
            ) {
              Bit8.setUint16(
                offset + characterIndex * 2,
                this.nick.charCodeAt(characterIndex),
                true
              );
            }

            offset = getString(Bit8, offset).offset;
            snakes[killedByID].network.send(Bit8);
            // Send "Killed By"
            var Bit8 = new DataView(new ArrayBuffer(16 + 2 * 1000));
            Bit8.setUint8(0, MessageTypes.SendEvent);
            var offset = 1;
            Bit8.setUint8(offset, EventTypes.Killed, true);
            offset += 1;
            Bit8.setUint16(offset, 0, true); //(ID?), unused.
            offset += 2;
            for (
                var characterIndex = 0;
                characterIndex < snakes[killedByID].nick.length;
                characterIndex++
            ) {
                Bit8.setUint16(
                offset + characterIndex * 2,
                snakes[killedByID].nick.charCodeAt(characterIndex),
                true
                );
            }
            offset = getString(Bit8, offset).offset;
            this.network.send(Bit8);
        }
        // Update other snakes
        
        if (!this.spawned) {
            return
        }
        Object.values(clients).forEach((snake) => {
            if (snake.loadedEntities[this.id]) {
                var Bit8 = new DataView(new ArrayBuffer(16 + 2 * 1000));
                Bit8.setUint8(0, MessageTypes.SendEntities);
                var offset = 1;
            
                Bit8.setUint16(offset, this.id, true);
                offset += 2;
                Bit8.setUint8(offset, UpdateTypes.OnRemove, true);
                offset += 1;
                Bit8.setUint16(offset, killedByID, true);
                offset += 2;
                Bit8.setUint8(offset, reason);
                offset += 1;
                Bit8.setFloat32(offset, this.position.x, true); //Kill position X
                offset += 4;
                Bit8.setFloat32(offset, this.position.y, true); //Kill position Y
                offset += 4;

                // King
                Bit8.setUint16(offset, 0, true);
                offset += 2;
                Bit8.setUint16(offset, king && king.id || 0, true);
                offset += 2;
                Bit8.setFloat32(offset, king && king.position.x || 0, true);
                offset += 4;
                Bit8.setFloat32(offset, king && king.position.y || 0, true);
                offset += 4;
                snake.network.send(Bit8);
                delete snake.loadedEntities[this.id]
            }
        });


        // Convert snake to food
        
        

        let actualLength = 0
        for (let i = -1; i < this.points.length - 1; i++) {
          let point;
          if (i == -1) point = this.position;
          else point = this.points[i];
          let nextPoint = this.points[i + 1];

          let segmentLength = getSegmentLength(point, nextPoint);
          actualLength += segmentLength;
        }

        function customEasing(t) {
            // Adjust the value of a for the desired effect
            const a = 8; // Controls the rate of slowing down

            // Apply easing equation
            return 1 - Math.exp(-a * t);
        }

        function easeOut(entity, targetPosition, duration) {
            const startX = entity.position.x;
            const startY = entity.position.y;
            const deltaX = targetPosition.x - startX;
            const deltaY = targetPosition.y - startY;

            const fps = 60; // frames per second
            const frameDuration = 1000 / fps;

            let startTime = null;

            const animate = (timestamp) => {
                if (!entity || !entity.position) return;
                if (!startTime) startTime = timestamp;
                const elapsed = timestamp - startTime;
                const progress = Math.min(elapsed / duration, 1); // Ensure progress doesn't exceed 1

                // Apply custom easing function to progress
                const easedProgress = customEasing(progress);

                // Calculate eased position
                entity.position.x = startX + deltaX * easedProgress;
                entity.position.y = startY + deltaY * easedProgress;

                if (progress < 1) {
                    // Continue animation until duration is reached
                    setTimeout(() => animate(performance.now()), frameDuration);
                }
            };

            // Start animation
            animate(performance.now());
        }



        let scoreToDrop = getScoreToDrop(actualLength);
        let foodToDrop = scoreToFood(scoreToDrop)*foodMultiplier;
        let dropAtInterval = actualLength / (foodToDrop);
        for (let i = 0; i < actualLength; i += dropAtInterval) {
            let point = getPointAtDistance(this, i);
            let nextPoint
            if (i == actualLength-1)
                nextPoint = this.position;
            else
                nextPoint = getPointAtDistance(this, i + 1);
            let food = new Food(point.x, point.y, this.color - 25 + Math.random() * 50, this, 20000 + (Math.random() * 60 * 1000 * 5));
            
            // Move food forward the direction that the line was going
            
            let direction = getNormalizedDirection(nextPoint, point);

            if (direction) {
                let amountDispersion = 2;
                let speedMultiplier = 2;
                let easingRandomX = Math.random() * (amountDispersion - (amountDispersion / 2));
                easingRandomX += (direction.x * this.speed * UPDATE_EVERY_N_TICKS * speedMultiplier);
                let easingRandomY = Math.random() * (amountDispersion - (amountDispersion / 2));
                easingRandomY += (direction.y * this.speed * UPDATE_EVERY_N_TICKS * speedMultiplier);
                easeOut(food, { x: point.x + easingRandomX, y: point.y + easingRandomY }, 5000);
            }
        }
        
        


        this.spawned = false;
        delete snakes[this.id];
        delete entities[this.id]

    }
    doPong() {
        this.pingStart = Date.now();
        var Bit8 = new DataView(new ArrayBuffer(3));
        Bit8.setUint8(0, MessageTypes.SendPingInfo);
        Bit8.setUint16(1, this.ping || 0, true);
        this.network.send(Bit8);
    }
    doPing() {
        var Bit8 = new DataView(new ArrayBuffer(1));
        Bit8.setUint8(0, MessageTypes.PingLoop);
        this.network.send(Bit8);
    }
    update(updateType, entities) {
        /* CALCULATING TOTAL BITS */
        var calculatedTotalBits = 1;
        Object.values(entities).forEach((entity) => {
            if (
                entity.position && entity.spawned &&
                (((updateType == UpdateTypes.OnUpdate || updateType == UpdateTypes.OnRemove) && this.loadedEntities[entity.id]) || updateType == UpdateTypes.OnRender) // Make sure that entity is rendered before making updates
            ) {
                calculatedTotalBits += 2 + 1;
                switch (updateType) {
                    case UpdateTypes.OnUpdate:
                        switch (entity.type) {
                            case EntityTypes.Player:
                                calculatedTotalBits += 4 + 4 + 4 + 4 + 1 + 2 + 1;
                                
                                if (entity.flags & EntityFlags.Debug) {
                                    calculatedTotalBits += 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 2;
                                }
                                if (entity.flags & EntityFlags.IsRubbing) {
                                    calculatedTotalBits += 4 + 4 + 2;
                                }
                                if (entity.flags & EntityFlags.Boosting) { }
                                if (entity.flags & EntityFlags.Ping) {
                                    calculatedTotalBits += 2;
                                }
                                if (entity.flags & EntityFlags.KilledKing) { }
                                if (entity.flags & EntityFlags.Killstreak) {
                                    calculatedTotalBits += 2;
                                }
                                if (entity.flags & EntityFlags.ShowTalking) {
                                    calculatedTotalBits += 1;
                                }
                                calculatedTotalBits += 1 + 1 + 1 + (4 + 4) * (entity.newPoints.length);
                                break;
                            case EntityTypes.Item:
                                calculatedTotalBits += 4 + 4;
                                break;
                        }
                        break
                    case UpdateTypes.OnRender:
                        calculatedTotalBits += 1 + 1
                        if (entity.type == EntityTypes.Player)
                            calculatedTotalBits += (1 + entity.nick.length) * 2;
                        else
                            calculatedTotalBits += 2;
                        
                        switch (entity.type) {
                            case EntityTypes.Player:
                                calculatedTotalBits += 4 + 4 + 4 + 4 + 1 + 2 + 1;
                                if (entity.flags & EntityFlags.Debug) {
                                    calculatedTotalBits += 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 2;
                                }
                                if (entity.flags & EntityFlags.IsRubbing) {
                                    calculatedTotalBits += 4 + 4 + 2;
                                }
                                if (entity.flags & EntityFlags.Boosting) { }
                                if (entity.flags & EntityFlags.Ping) {
                                    calculatedTotalBits += 2;
                                }
                                if (entity.flags & EntityFlags.KilledKing) { }
                                if (entity.flags & EntityFlags.Killstreak) {
                                    calculatedTotalBits += 2;
                                }
                                if (entity.flags & EntityFlags.ShowTalking) {
                                    calculatedTotalBits += 1;
                                }
                                
                                calculatedTotalBits += 1 + 1
                                calculatedTotalBits += (4 + 4) * entity.points.length;
                                calculatedTotalBits += 2 + 1;
                                break
                            case EntityTypes.Item:
                                calculatedTotalBits += 4 + 4 + 2;
                                break
                        }
                        break
                    case UpdateTypes.OnRemove:
                        calculatedTotalBits += 2 + 1
                        
                        switch (entity.type) {
                            case EntityTypes.Player:
                                calculatedTotalBits += 4 + 4;
                                break
                            case EntityTypes.Item:

                                break
                        }
                        break
                }
            }
        })
        calculatedTotalBits += 2 + 2 + 4 + 4; // King bits
        var Bit8 = new DataView(new ArrayBuffer(calculatedTotalBits));
        Bit8.setUint8(0, MessageTypes.SendEntities);
        var offset = 1;
        

        Object.values(entities).forEach((entity) => {
            if (
                entity.position && entity.spawned &&
                (((updateType == UpdateTypes.OnUpdate || updateType == UpdateTypes.OnRemove) && this.loadedEntities[entity.id]) || updateType == UpdateTypes.OnRender) // Make sure that entity is rendered before making updates
            ) {
                Bit8.setUint16(offset, entity.id, true);
                offset += 2;
                Bit8.setUint8(offset, updateType, true);
                offset += 1;
                switch (updateType) {
                    case UpdateTypes.OnUpdate:
                        switch (entity.type) {
                            case EntityTypes.Player:
                                Bit8.setFloat32(offset, entity.position.x, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.position.y, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.speed, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.length, true);
                                offset += 4;
                                offset += 1;
                                Bit8.setUint16(offset, entity.points.length, true);
                                offset += 2;
                                Bit8.setUint8(offset, entity.flags, true);
                                offset += 1;
                                if (entity.flags & EntityFlags.Debug) {
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;

                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;

                                    Bit8.setUint16(offset, 0, true);

                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.IsRubbing) {
                                    Bit8.setFloat32(offset, entity.rubX, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, entity.rubY, true);
                                    offset += 4;
                                    Bit8.setUint16(offset, entity.RubSnake, true);
                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.Boosting) { }
                                if (entity.flags & EntityFlags.Ping) {
                                    Bit8.setUint16(offset, entity.ping || 0, true);
                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.KilledKing) { }
                                if (entity.flags & EntityFlags.Killstreak) {
                                    Bit8.setUint16(offset, entity.killstreak, true);
                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.ShowTalking) {
                                    Bit8.setUint8(offset, entity.talkId, true);
                                    offset += 1;
                                }
                                
                                Bit8.setUint8(offset, entity.talkStamina, true);
                                offset += 1;
                                Bit8.setUint8(offset, entity.extraSpeed, true);
                                offset += 1;
                                let newPointsLength = entity.newPoints.length
                                Bit8.setUint8(offset, newPointsLength, true);
                                offset += 1;
                                for (let i = newPointsLength - 1; i >= 0; i--) {
                                    let point = entity.newPoints[i];
                                    Bit8.setFloat32(offset, point.x, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, point.y, true);
                                    offset += 4;
                                }
                                break;
                            case EntityTypes.Item:
                                Bit8.setFloat32(offset, entity.position.x, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.position.y, true);
                                offset += 4;
                                break;
                        }
                        break
                    case UpdateTypes.OnRender:
                        Bit8.setUint8(offset, entity.type, true);
                        offset += 1;
                        Bit8.setUint8(offset, entity.subtype || 0, true);
                        offset += 1;
                        if (entity.type == EntityTypes.Player) {
                            for (var characterIndex = 0; characterIndex < entity.nick.length; characterIndex++) {
                                Bit8.setUint16(offset + characterIndex * 2, entity.nick.charCodeAt(characterIndex), true);
                            }
                            offset += (1 + entity.nick.length) * 2;
                        } else {
                            Bit8.setUint16(offset, 0, true);
                            offset += 2;
                        }
                        
                        switch (entity.type) {
                            case EntityTypes.Player:
                                Bit8.setFloat32(offset, entity.position.x, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.position.y, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.speed, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.length, true);
                                offset += 4;
                                offset += 1;
                                Bit8.setUint16(offset, entity.points.length, true);
                                offset += 2;
                                Bit8.setUint8(offset, entity.flags, true);
                                offset += 1;
                                if (entity.flags & EntityFlags.Debug) {
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;

                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, 0, true);
                                    offset += 4;

                                    Bit8.setUint16(offset, 0, true);

                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.IsRubbing) {
                                    Bit8.setFloat32(offset, entity.rubX, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, entity.rubY, true);
                                    offset += 4;
                                    Bit8.setUint16(offset, entity.RubSnake, true);
                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.Boosting) { }
                                if (entity.flags & EntityFlags.Ping) {
                                    Bit8.setUint16(offset, entity.ping || 0, true);
                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.KilledKing) { }
                                if (entity.flags & EntityFlags.Killstreak) {
                                    Bit8.setUint16(offset, entity.killstreak, true);
                                    offset += 2;
                                }
                                if (entity.flags & EntityFlags.ShowTalking) {
                                    Bit8.setUint8(offset, entity.talkId, true);
                                    offset += 1;
                                }
                                Bit8.setUint8(offset, entity.talkStamina, true);
                                offset += 1;
                                Bit8.setUint8(offset, entity.extraSpeed, true);
                                offset += 1;
                                for (let i = 0; i < entity.points.length; i++) {
                                    let point = entity.points[i];
                                    Bit8.setFloat32(offset, point.x, true);
                                    offset += 4;
                                    Bit8.setFloat32(offset, point.y, true);
                                    offset += 4;
                                }
                                Bit8.setUint16(offset, entity.color, true);
                                offset += 2;
                                Bit8.setUint8(offset, 0, true);
                                offset += 1;
                                break;
                            case EntityTypes.Item:
                                Bit8.setFloat32(offset, entity.position.x, true);
                                offset += 4;
                                
                                Bit8.setFloat32(offset, entity.position.y, true);
                                offset += 4;
                                Bit8.setUint16(offset, entity.color, true);
                                offset += 2;
                                break;

                        }
                        this.loadedEntities[entity.id] = entity;

                        break;
                    case UpdateTypes.OnRemove:
                        Bit8.setUint16(offset, 0, true); // Set to 0 to disable sounds
                        offset += 2;
                        Bit8.setUint8(offset, KillReasons.LeftScreen, true);
                        offset += 1;
                        delete this.loadedEntities[entity.id]
                        switch (entity.type) {
                            case EntityTypes.Player:
                                Bit8.setFloat32(offset, entity.position.x, true);
                                offset += 4;
                                Bit8.setFloat32(offset, entity.position.y, true);
                                offset += 4;
                                break
                            case EntityTypes.Item:
                                break
                        }
                        break;
                }
            }
        })
        Bit8.setUint16(offset, 0, true);
        offset += 2;
        Bit8.setUint16(offset, king && king.id || 0, true);
        offset += 2;
        Bit8.setFloat32(offset, king && king.position.x || 0, true);
        offset += 4;
        Bit8.setFloat32(offset, king && king.position.y || 0, true);
        offset += 4;
        
      this.network.send(Bit8);
    }
    numDebugCircle = 0
    DrawDebugCircle(x, y, color = 100, size = 4) {
        this.numDebugCircle++
        let id = this.numDebugCircle;
        var Bit8 = new DataView(new ArrayBuffer(49));
        var offset = 0;
        Bit8.setUint8(offset, 0xa7);
        offset += 1;
        Bit8.setUint16(offset, id, true);
        offset += 2;
        Bit8.setUint8(offset, 1, true);
        offset += 1;
        Bit8.setFloat32(offset, x, true);
        offset += 4;
        Bit8.setFloat32(offset, y, true);
        offset += 4;
        Bit8.setUint16(offset, color, true);
        offset += 2;
        Bit8.setUint8(offset, size, true);
        this.network.send(Bit8);
        return id
    }
    DeleteDebugCircle(circle) {
        var Bit8 = new DataView(new ArrayBuffer(49));
        var offset = 0;
        Bit8.setUint8(offset, 0xa7);
        offset += 1;
        Bit8.setUint8(offset, circle, true);
        offset += 1;
        Bit8.setUint16(offset, 0, true);
    }
    Talk(id) {
        this.flags |= EntityFlags.ShowTalking;
        this.talkId = id;
        let oldTalkId = id;
        setTimeout(() => {
            if (this.talkId == oldTalkId)
                this.flags &= ~EntityFlags.ShowTalking;
        }, 5000)

    }
    RecieveMessage(messageType, view) {
        if (messageType != MessageTypes.RecieveNick && !this.id) {
            return
        }
        switch (messageType) {
            case MessageTypes.RecievePing:
                this.doPong();
                this.doPing();
                break;
            case MessageTypes.RecieveNick:
                var nick = getString(view, 1);
                console.log("Spawning snake " + nick.string);
                if (!this.spawned)
                    this.spawn(nick.string);
                break;
            case MessageTypes.RecieveTurnPoint:
                let offset = 1;
                let direction = view.getUint8(offset, true);
                offset += 1;
                let vector = view.getFloat32(offset, true);
                offset += 4;
                let isFocused = view.getUint8(offset, true) & 1;
                this.turn(direction, vector);
                break;
            case MessageTypes.RecieveTalk:
                if (this.talkStamina >= 255) {
                    this.Talk(view.getUint8(1, true));
                    this.talkStamina = 0;
                }
                break;
            case MessageTypes.RecieveResize:
                this.windowSizeX = view.getUint16(1, true)/2;
                this.windowSizeY = view.getUint16(3, true)/2;
                break;
            case MessageTypes.RecieveHello:
                this.windowSizeX = view.getUint16(1, true)/2;
                this.windowSizeY = view.getUint16(3, true)/2;
            case MessageTypes.RecieveDebugHello:
                this.windowSizeX = view.getUint16(1, true)/2;
                this.windowSizeY = view.getUint16(3, true) / 2;
            case MessageTypes.RecieveBoost:
                if (admins.includes(this.ip)) {
                    let boosting = view.getUint8(1) == 1
                    if (boosting) {
                        this.extraSpeed += 2;
                        if (this.extraSpeed > maxBoostSpeed)
                            this.speedBypass = true
                        this.speed = 0.25 + this.extraSpeed / (255 * UPDATE_EVERY_N_TICKS);
                    } else {
                        this.speedBypass = false;
                        if (this.extraSpeed > maxBoostSpeed)
                            this.extraSpeed = maxBoostSpeed
                    }
                }
                break;
            case MessageTypes.RecieveDebugFoodGrab:
                if (admins.includes(this.ip))
                    this.length += scoreToLength(1000);
                break;
            case 0x0d: // Invincible
                if (admins.includes(this.ip))
                    this.invincible = view.getUint8(1, true) == 1;
            
                break;
            case 0x0e: // Commands
                if (admins.includes(this.ip)) {
                    let command = getString(view, 1).string;
                    if (!command)
                        return
                    command = command.toLowerCase()
                    let commandArgs = command.split(" ");
                    if (!commandArgs[0])
                        return
                    switch (commandArgs[0]) {
                        case "arenasize":
                            if (commandArgs[1]) {
                                let size = parseInt(commandArgs[1]);
                                if (size) {
                                    arenaSize = size;
                                    Object.values(clients).forEach((client) => {
                                        client.sendConfig()
                                    })
                                }
                            }
                            break;
                        case "maxboostspeed":
                            if (commandArgs[1]) {
                                let speed = parseInt(commandArgs[1]);
                                if (speed) {
                                    maxBoostSpeed = speed;
                                }
                            }
                            break;
                        case "maxrubspeed":
                            if (commandArgs[1]) {
                                let speed = parseInt(commandArgs[1]);
                                if (speed) {
                                    maxRubSpeed = speed;
                                }
                            }
                            break;
                        case "updateduration":
                            if (commandArgs[1]) {
                                let duration = parseInt(commandArgs[1]);
                                if (duration) {
                                    updateDuration = duration;
                                }
                            }
                            break;
                        case "maxfood":
                            if (commandArgs[1]) {
                                let max = parseInt(commandArgs[1]);
                                if (max) {
                                    maxFood = max;
                                }
                            }
                            break;
                        case "foodspawnpercent":
                            if (commandArgs[1]) {
                                let rate = parseInt(commandArgs[1]);
                                if (rate) {
                                    foodSpawnPercent = rate;
                                }
                            }
                            break;
                        case "defaultlength":
                            if (commandArgs[1]) {
                                let length = parseInt(commandArgs[1]);
                                if (length) {
                                    defaultLength = length;
                                }
                            }
                            break;
                        case "randomfood":
                            if (commandArgs[1]) {
                                let num = parseInt(commandArgs[1]);
                                if (num) {
                                    for (let i = 0; i < num; i++) {
                                        new Food();
                                    }
                                }
                            }
                            break;
                        case "clearfood":
                            Object.values(entities).forEach((entity) => {
                                if (entity.type == EntityTypes.Item)
                                    entity.eat();
                            })
                            break;
                        case "foodmultiplier":
                            if (commandArgs[1]) {
                                let multiplier = parseInt(commandArgs[1]);
                                if (multiplier) {
                                    foodMultiplier = multiplier;
                                }
                            }
                            break;
                        case "foodvalue":
                            if (commandArgs[1]) {
                                let value = parseInt(commandArgs[1]);
                                if (value) {
                                    foodValue = value;
                                    Object.values(entities).forEach((entity) => {
                                        if (entity.type == EntityTypes.Item)
                                            entity.value = foodValue;

                                    })
                                }
                            }
                            break;

                    }
                }
                break;

        }
    }

}


let newSnakes = [];

function round(num) {
    return Math.round(num / 1000) * 1000
}
class Client extends EventEmitter {
    constructor(websocket, ip) {
        super();
        this.socket = websocket;
        this.nick = "";
        this.id = 0;
        if (ip.toString() == "::1") // Set IP to local
            ip = "::ffff:127.0.0.1"
            
        this.ip = (ip.toString()).split(":")[3];
        console.log(`Client connected from "${this.ip}"`);
    }
}




function getString(data, bitOffset) {
    var nick = "";
    while (true) {
        var charCode = data.getUint16(bitOffset, true);
        bitOffset += 2;
        if (0 == charCode) break;
        nick += String.fromCharCode(charCode);
    }
    return { string: nick, offset: bitOffset };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
if (wssSecure) {
    wssSecure.on('connection', async function connection(ws, req) {
        let client = new Client(ws, req.socket.remoteAddress);
        let snake = new Snake(client);
        ws.on('message', async function incoming(message, req) {
            let view = new DataView(new Uint8Array(message).buffer);
            let messageType = view.getUint8(0);
            snake.RecieveMessage(messageType, view)
        })
        ws.on('close', function close() {
            if (snake.id) {
                snake.kill(KillReasons.LeftScreen, snake.id);
                delete clients[snake.id];
            }
        })
    });
}

wss.on('connection', async function connection(ws, req) {
    let client = new Client(ws, req.socket.remoteAddress);
    let snake = new Snake(client);
    ws.on('message', async function incoming(message, req) {
        let view = new DataView(new Uint8Array(message).buffer);
        let messageType = view.getUint8(0);
        snake.RecieveMessage(messageType, view)
    })
    ws.on('close', function close() {
        if (snake.id) {
            snake.kill(KillReasons.LeftScreen, snake.id);
            delete clients[snake.id];
        }
    })
});

function getNormalizedDirection(lineStart, lineEnd) {
    if (lineStart.y > lineEnd.y) {
        return { x: 0, y: -1 }
    }
    else if (lineStart.y < lineEnd.y) {
        return { x: 0, y: 1 }
    }
    else if (lineStart.x < lineEnd.x) {
        return { x: 1, y: 0 }
    }
    else if (lineStart.x > lineEnd.x) {
        return { x: -1, y: 0 }
    }
}

function getSegmentLength(point1, point2) {
    return Math.abs(Math.sqrt(Math.pow(point2.x - point1.x, 2) + Math.pow(point2.y - point1.y, 2)));
}

function nearestPointOnLine(point, lineStart, lineEnd) // Returns point on line closest to point
{
    let A = point.x - lineStart.x;
    let B = point.y - lineStart.y;
    let C = lineEnd.x - lineStart.x;
    let D = lineEnd.y - lineStart.y;

    let dot = A * C + B * D;
    let len_sq = C * C + D * D;
    let param = -1;
    if (len_sq != 0) //in case of 0 length line
        param = dot / len_sq;

    let xx, yy;

    if (param < 0) {
        xx = lineStart.x;
        yy = lineStart.y;
    } else if (param > 1) {
        xx = lineEnd.x;
        yy = lineEnd.y;
    } else {
        xx = lineStart.x + param * C;
        yy = lineStart.y + param * D;
    }

    let dx = point.x - xx;
    let dy = point.y - yy;
    return { point: { x: xx, y: yy }, distance: Math.sqrt(dx * dx + dy * dy) };
}

function onSegment(p, q, r) 
{ 
    if (q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && 
        q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y)) 
       return true; 
  
    return false; 
} 

function orientation(p, q, r) 
{ 
    // See https://www.geeksforgeeks.org/orientation-3-ordered-points/ 
    // for details of below formula. 
    val = (q.y - p.y) * (r.x - q.x) - 
              (q.x - p.x) * (r.y - q.y); 
  
    if (val == 0) return 0;
  
    return (val > 0)? 1: 2;
} 
  
// The main function that returns true if line segment 'p1q1'  
function doIntersect( p1,  q1,  p2,  q2) 
{ 
    // Find the four orientations needed for general and 
    // special cases 
    o1 = orientation(p1, q1, p2); 
    o2 = orientation(p1, q1, q2); 
    o3 = orientation(p2, q2, p1); 
    o4 = orientation(p2, q2, q1); 
  
    // General case 
    if (o1 != o2 && o3 != o4) 
        return true; 
  
    // Special Cases 
    // p1, q1 and p2 are collinear and p2 lies on segment p1q1 
    if (o1 == 0 && onSegment(p1, p2, q1)) return true; 
  
    // p1, q1 and q2 are collinear and q2 lies on segment p1q1 
    if (o2 == 0 && onSegment(p1, q2, q1)) return true; 
  
    // p2, q2 and p1 are collinear and p1 lies on segment p2q2 
    if (o3 == 0 && onSegment(p2, p1, q2)) return true; 
  
     // p2, q2 and q1 are collinear and q1 lies on segment p2q2 
    if (o4 == 0 && onSegment(p2, q1, q2)) return true; 
  
    return false; // Doesn't fall in any of the above cases 
} 

function getPointAtDistance(snake, distance) // Returns point that is distance away from head
{
    let totalPointLength = 0;
    for (let i = -1; i < snake.points.length - 1; i++) {
        let point;
        if (i == -1)
            point = snake.position;
        else
            point = snake.points[i];
        let nextPoint = snake.points[i + 1];

        

        let segmentLength = getSegmentLength(point, nextPoint);
        totalPointLength += segmentLength;
        if (totalPointLength > distance) { // The point is in this segment
            let segmentOverLength = segmentLength - (totalPointLength-distance);
            let direction = getNormalizedDirection(point, nextPoint);
            let lookForPoint = { x: point.x + (direction.x * segmentOverLength), y: point.y + (direction.y * segmentOverLength) };
            //snake.DrawDebugCircle(point.x, point.y, 100);
            //snake.DrawDebugCircle(nextPoint.x, nextPoint.y, 100);
            //snake.DrawDebugCircle(lookForPoint.x, lookForPoint.y, 20);
            return lookForPoint;

        }
    }
    return snake.position;
}


function UpdateArena() { // Main update loop
    let numSnak = 0;
    let numPoints = 0;
    Object.values(snakes).forEach(function (snake) {
        numSnak++
        // Make snakes move
        let totalSpeed = snake.speed //+ (snake.extraSpeed/255);
        if (snake.direction == Directions.Up) {
            snake.position.y += totalSpeed * UPDATE_EVERY_N_TICKS;
        } else if (snake.direction == Directions.Left) {
            snake.position.x -= totalSpeed * UPDATE_EVERY_N_TICKS;
        } else if (snake.direction == Directions.Down) {
            snake.position.y -= totalSpeed * UPDATE_EVERY_N_TICKS;
        } else if (snake.direction == Directions.Right) {
            snake.position.x += totalSpeed * UPDATE_EVERY_N_TICKS;
        }

        // Collision Checks
        if (
            snake.position.x > arenaSize / 2 ||
            snake.position.x < -arenaSize / 2 ||
            snake.position.y > arenaSize / 2 ||
            snake.position.y < -arenaSize / 2
        ) {
            setTimeout(() => { // Make sure they didn't move out of the way
                if (
                    snake.position.x > arenaSize / 2 ||
                    snake.position.x < -arenaSize / 2 ||
                    snake.position.y > arenaSize / 2 ||
                    snake.position.y < -arenaSize / 2
                ) {
                    snake.kill(KillReasons.Boundary, snake.id);
                }
            }, snake.ping || 50)
        }
        let shouldRub = false;
        let secondPoint = snake.points[0];
        // Other snake collision checks
        Object.values(snake.loadedEntities).forEach(function (otherSnake) {
            if (otherSnake.type != EntityTypes.Player)
                return
            // Check if head of snake of near body of other snake

            let closestRubLine

            //for (let i = -1; i < otherSnake.points.length - 1; i++) {
            let nearbyPoints = pointsNearSnake(snake, otherSnake, 30);
            for (let i = 0; i < nearbyPoints.length - 1; i++) {
                numPoints++
                let point, nextPoint;
                point = nearbyPoints[i];
                nextPoint = nearbyPoints[i + 1];
                if (nextPoint.index != point.index + 1)
                    continue
                point = point.point;
                nextPoint = nextPoint.point;

                // Rubbing Mechanics
                if (otherSnake.id != snake.id) {
                    
                    if (i <= otherSnake.points.length - 1) {
                        let data = nearestPointOnLine(
                            snake.position,
                            point,
                            nextPoint
                        );
                        // Check if this line is in the same direction
                        let direction = getNormalizedDirection(point, nextPoint);
                        let snakeDirection = getNormalizedDirection(snake.position, secondPoint);
                        let noRub = false;
                        if (direction && snakeDirection) {
                            if (!(Math.abs(direction.x) == Math.abs(snakeDirection.x) && Math.abs(direction.y) == Math.abs(snakeDirection.y)))
                                noRub = true
                            if (data.distance >= 4)
                                noRub = true
                            if (closestRubLine && data.distance > closestRubLine.distance)
                                noRub = true
                            if (!noRub)
                                closestRubLine = {
                                    point: data.point,
                                    distance: data.distance
                                }
                        }
                    }
                    
                }
                

                // Collision Mechanics

                if (snake.position != nextPoint && secondPoint != point && snake.position != secondPoint && snake.position != point) {
                    if (doIntersect(snake.position, secondPoint, point, nextPoint)) {
                        setTimeout(() => { // Make sure they didn't move out of the way
                            if (snake.position != nextPoint && secondPoint != point && snake.position != secondPoint && snake.position != point) {
                                if (doIntersect(snake.position, secondPoint, point, nextPoint)) {
                                    if (snake.id == otherSnake.id) {
                                        snake.kill(KillReasons.Self, snake.id);
                                    } else {
                                        snake.kill(KillReasons.Killed, otherSnake.id);
                                    }
                                }
                            }
                        }, snake.ping || 50)
                    }
                }

                // Check if any points are colliding

            }
            if (closestRubLine) {
                shouldRub = true;
                snake.rubX = closestRubLine.point.x;
                snake.rubY = closestRubLine.point.y;
                snake.rubAgainst(otherSnake, closestRubLine.distance);
            }
        })
        if (!shouldRub) {
          snake.stopRubbing();
        }

        if (!snake.speeding) {
            if (snake.extraSpeed-2 > 0) {
                snake.extraSpeed -= 2;
                snake.speed = 0.25 + snake.extraSpeed / (255 * UPDATE_EVERY_N_TICKS);
            }

        }
    });
    //console.log(`Updated ${numSnak} snakes and ${numPoints} points`)
}

function entitiesNearSnake(snake) { // Returns entities near snake and loaded entities that are not in radius
    let entitiesInRadius = entitiesWithinRadius({ x: snake.position.x, y: snake.position.y }, Object.values(entities), snake);
    let loadedEntities = Object.values(snake.loadedEntities);
    let entitiesToAdd = entitiesInRadius.filter(entity => !loadedEntities.includes(entity));
    let entitiesToRemove = loadedEntities.filter(entity => !entitiesInRadius.includes(entity));
    return { entitiesToAdd, entitiesToRemove };
}

async function main() {
    let timeStart = Date.now();
    UpdateArena()
    console.log(`UpdateArena took ${Date.now() - timeStart}ms`)
    let num = 0
    let timeElapsed2 = 0;
    let timeElapsed3 = 0;
    let timeElapsed4 = 0;
    let timeElapsed5 = 0;
    let timeElapsed6 = 0;
    let timeElapsed7 = 0;
    let timeElapsed8 = 0;
    let timeElapsed9 = 0;



    
    
    

    // Add random food spawns
    
    
    if (Object.keys(entities).length < maxFood) {
        if (Math.random()*100 < foodSpawnPercent) {
            new Food();
        }
        
    }
    timeStart = Date.now();
    const clientSnakes = Object.values(clients);

    clientSnakes.forEach(function (snake) {
        if (snake.id && snake.spawned) {
            num++
            let timeStart2 = Date.now();
            const updatedEntities = [];
            const loadedEntitiesValues = Object.values(snake.loadedEntities);
            entitiesNearSnakeCalc = Date.now();
            const { entitiesToAdd: nearbyEntities, entitiesToRemove: removeEntities } = entitiesNearSnake(snake);
            timeElapsed2 += Date.now() - timeStart2;

            // Combine entity updates
            let timeStart3 = Date.now();
            updatedEntities.push(...nearbyEntities, ...loadedEntitiesValues.filter(entity =>
                entity.type === EntityTypes.Player || (entity.type === EntityTypes.Item && entity.lastUpdate > lastUpdate)
            ));
            timeElapsed3 += Date.now() - timeStart3;

            // Update snake for rendering and removal
            let timeStart4 = Date.now();
            snake.update(UpdateTypes.OnRender, nearbyEntities);
            timeElapsed4 += Date.now() - timeStart4;
            let timeStart5 = Date.now();
            snake.update(UpdateTypes.OnRemove, removeEntities);
            timeElapsed5 += Date.now() - timeStart5;

            // Update snake for each loaded entity
            let timeStart6 = Date.now();
            loadedEntitiesValues.forEach(function (entity) {
                if (entity && entity.spawned && entity.subtype === EntitySubtypes.Food) {
                    const distanceSquared = Math.pow(snake.position.x - entity.position.x, 2) +
                                            Math.pow(snake.position.y - entity.position.y, 2);
                    if (distanceSquared < 9) { // Using distance squared to avoid square root calculation
                        entity.eat(snake);
                    }
                }
            });
            timeElapsed6 += Date.now() - timeStart6;

            // Update snake for all updated entities
            let timeStart7 = Date.now();
            snake.update(UpdateTypes.OnUpdate, updatedEntities);
            timeElapsed7 += Date.now() - timeStart7;

            // Handle talk stamina
            snake.talkStamina = Math.min(255, snake.talkStamina + 5); // Using Math.min to clamp the value

            let timeStart8 = Date.now();
            // Calculate tail length
            const totalPointLength = getSnakeTotalPointLength(snake);
            if (totalPointLength > snake.length) {
                adjustSnakeTailLength(snake, totalPointLength);
            }
            timeElapsed8 += Date.now() - timeStart8;

            // Update leaderboard
            let timeStart9 = Date.now();
            snake.updateLeaderboard();
            timeElapsed9 += Date.now() - timeStart9;
        }
    });
    console.log(`TimeElapsed2 took ${timeElapsed2}ms`)
    console.log(`TimeElapsed3 took ${timeElapsed3}ms`)
    console.log(`TimeElapsed4 took ${timeElapsed4}ms`)
    console.log(`TimeElapsed5 took ${timeElapsed5}ms`)
    console.log(`TimeElapsed6 took ${timeElapsed6}ms`)
    console.log(`TimeElapsed7 took ${timeElapsed7}ms`)
    console.log(`TimeElapsed8 took ${timeElapsed8}ms`)
    console.log(`TimeElapsed9 took ${timeElapsed9}ms`)

    function getSnakeTotalPointLength(snake) {
        let totalPointLength = 0;
        const points = [snake.position, ...snake.points]; // Include snake position in points array
        for (let i = 0; i < points.length - 1; i++) {
            totalPointLength += getSegmentLength(points[i], points[i + 1]);
        }
        return totalPointLength;
    }

    function adjustSnakeTailLength(snake, totalPointLength) {
        let remainingLength = totalPointLength - snake.length;
        const points = snake.points.slice(); // Clone points array

        // Start from the end of the points array
        for (let i = points.length - 2; i >= 0; i--) {
            remainingLength -= getSegmentLength(points[i], points[i + 1]);
            if (remainingLength <= 0) {
                // Calculate the new position of the last point based on remaining length
                const direction = getNormalizedDirection(points[i], points[i + 1]);
                const newPoint = {
                    x: points[i + 1].x - direction.x * Math.abs(remainingLength),
                    y: points[i + 1].y - direction.y * Math.abs(remainingLength)
                };
                // Update snake points array
                snake.points = points.slice(0, i + 1).concat(newPoint);
                break;
            }
        }
    }
    console.log(`UpdateClients took ${Date.now() - timeStart}ms`)

    Object.values(clients).forEach(function (snake) {
        snake.newPoints = []
    })
    lastUpdate = Date.now();
    

}

function mainLooper() {
    setTimeout(() => {
        if (Date.now()-lastUpdate >= updateDuration)
            main()
        mainLooper()
    }, 1)
}


function SimulateGame(first) { // Simulate as if there is a ton of players
    if (first)
        for (let i = 0; i < 100; i++) {
            let client = new Client({ send: () => { } }, "::1")
            let snake = new Snake(client, true)
            snake.spawn("Simulated")
        }
    
    Object.values(snakes).forEach(function (snake) {
        if (snake.simulated) {
            let shouldTurn = Math.random() * 100 < 1;
            if (shouldTurn) {
                let direction = Math.floor(Math.random() * 4);
                let vector;

                switch (direction) {
                    case Directions.Up:
                        vector = snake.position.y;
                        break
                    case Directions.Left:
                        vector = snake.position.x;
                        break
                    case Directions.Down:
                        vector = snake.position.y;
                        break
                    case Directions.Right:
                        vector = snake.position.x;
                        break
                }
                snake.turn(direction, vector);
            }
        }

        

    })

    setTimeout(() => {
        SimulateGame()
    }, 10)

}
//SimulateGame(true)

mainLooper()