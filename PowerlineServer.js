const WebSocket = require('ws');
const HttpsServer = require('https').createServer;
const fs = require("fs");
const EventEmitter = require("events");


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
const wss = new WebSocket.Server({ port: 1337});
var snakes = {}
var entities = {}
var clients = {}
var queuedEntityRenders = {}
var queuedEntityUpdates = {}
var lastClientId = 1
var lastEntityId = 1
var arenaSize = 300
var safezone = 0.01 // Safezone
//var updateDuration = 100
var updateDuration = 100
var UPDATE_EVERY_N_TICKS = 3;
let maxBoostSpeed = 200;
var foodValue = 1.5;
var scoreMultiplier = 10/foodValue;
var defaultLength = 10;
var king = null;

class QuadEntityTree {
    constructor(bounds, capacity) {
        this.bounds = bounds;
        this.capacity = capacity;
        this.entities = [];
        this.children = [];
    }

    insert(entity) {
        if (!this.bounds.contains([entity.position.x, entity.position.y])) {
            return false;
        }

        if (this.entities.length < this.capacity) {
            this.entities.push(entity);
            return true;
        }

        if (!this.children.length) {
            this.subdivide();
        }

        for (const child of this.children) {
            if (child.insert(entity)) {
                return true;
            }
        }

        // Point cannot be inserted (should never happen in this example)
        return false;
    }

    subdivide() {
        const { x, y, width, height } = this.bounds;
        const halfWidth = width / 2;
        const halfHeight = height / 2;

        this.children.push(
            new QuadEntityTree(new Bounds(x, y, halfWidth, halfHeight), this.capacity),
            new QuadEntityTree(new Bounds(x + halfWidth, y, halfWidth, halfHeight), this.capacity),
            new QuadEntityTree(new Bounds(x, y + halfHeight, halfWidth, halfHeight), this.capacity),
            new QuadEntityTree(new Bounds(x + halfWidth, y + halfHeight, halfWidth, halfHeight), this.capacity)
        )

        for (const entity of this.entities) {
            for (const child of this.children) {
                if (child.insert(entity)) {
                    break;
                }
            }
        }

        this.entities = [];
    }

    queryRange(range, found) {
        if (!found) {
            found = [];
        }

        if (!this.bounds.intersects(range)) {
            return found;
        }

        for (const entity of this.entities) {
            let alreadyAdded = false;
            if (entity.type === EntityTypes.Player) {
                for (let i = 0; i < entity.points.length - 1; i++) {
                    const point = entity.points[i];
                    const nextPoint = entity.points[i + 1];
                    if (this.intersectsCircle(point, nextPoint, range)) {
                        found.push(entity);
                        alreadyAdded = true;
                        break;
                    }
                }
            }
            if (!alreadyAdded && range.contains([entity.position.x, entity.position.y])) {
                found.push(entity);
            }
        }

        for (const child of this.children) {
            child.queryRange(range, found);
        }

        return found;
    }

    intersectsCircle(pointA, pointB, circle) {
        const dx = pointB[0] - pointA[0];
        const dy = pointB[1] - pointA[1];
        const len2 = dx * dx + dy * dy;
        const dot = ((circle.x - pointA[0]) * dx + (circle.y - pointA[1]) * dy) / len2;
        const closestX = pointA[0] + dot * dx;
        const closestY = pointA[1] + dot * dy;

        if (closestX < Math.min(pointA[0], pointB[0]) || closestX > Math.max(pointA[0], pointB[0]) ||
            closestY < Math.min(pointA[1], pointB[1]) || closestY > Math.max(pointA[1], pointB[1])) {
            return false;
        }

        const distanceSquared = (circle.x - closestX) * (circle.x - closestX) + (circle.y - closestY) * (circle.y - closestY);
        return distanceSquared <= circle.radius * circle.radius;
    }

}

class Bounds {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    contains(point) {
        return (
            point[0] >= this.x &&
            point[0] <= this.x + this.width &&
            point[1] >= this.y &&
            point[1] <= this.y + this.height
        );
    }

    intersects(otherBounds) {
        return !(
            otherBounds.x > this.x + this.width ||
            otherBounds.x + otherBounds.width < this.x ||
            otherBounds.y > this.y + this.height ||
            otherBounds.y + otherBounds.height < this.y
        );
    }
}

function entitiesWithinRadius(center, entities, radius) {
    const quadtreeBounds = new Bounds(center[0] - radius, center[1] - radius, radius * 2, radius * 2);
    const quadtree = new QuadEntityTree(quadtreeBounds, 4);

    for (const entity of entities) {
        quadtree.insert(entity);
    }

    const range = new Bounds(center[0] - radius, center[1] - radius, radius * 2, radius * 2);

    let entitiesFound = quadtree.queryRange(range);

    return entitiesFound;
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
    RecieveDebugHello: 171,
    RecieveHello: 191,
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
  value = foodValue;
  constructor(x, y, color, origin) {
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
    Object.values(snakes).forEach((snake) => {
        snake.queuedEntityRenders[this.id] = this
    });
      setTimeout(() => {
          //this.eat();
          
        
      }, 5000+Math.random() * 60000);
    return this;
  }
    eat(snake) {
        this.spawned = false
        if (snake && this.origin == snake.id) {
            return;
        }
        if (snake) {
            snakes[snake.id].extraSpeed += 2;
            //if (snake.extraSpeed > maxBoostSpeed)
                //snakes[snake.id].extraSpeed = maxBoostSpeed;
            snakes[snake.id].speed = 0.25 + snake.extraSpeed / (255 * UPDATE_EVERY_N_TICKS);

        }
        
        Object.values(clients).forEach((snakee) => {
            if (snakee.id) {
                if (queuedEntityRenders[this.id])
                    delete queuedEntityRenders[this.id];
                var Bit8 = new DataView(new ArrayBuffer(16 + 2 * 1000));
                Bit8.setUint8(0, MessageTypes.SendEntities);
                var offset = 1;
                //console.log("Removing entity food " + this.id + " from snake " + snakee.id);
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
        })
        if (snake) {
            snake.length += this.value;
            snake.lastAte = Date.now();
        }
        delete entities[this.id];
        
  }
}

for (let i = 0; i < arenaSize ^ 2 / 60; i++) {
//for (let i = 0; i < 30; i++) {
    new Food();
}

function GetRandomPosition() {
    return { x: Math.random() * arenaSize - arenaSize / 2, y: Math.random() * arenaSize - arenaSize / 2 };
}


class Snake {
    network = null;
    nick = "";
    type = EntityTypes.Player;
    queuedEntityRenders = {};
    queuedEntityUpdates = {};
    loadedEntities = {};
    constructor(network) {
        this.network = network.socket;
        this.sendConfig();

        if (!this.id) {
          clients[lastClientId] = this;
          lastClientId++;
        }
    }
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
        this.extraSpeed = 0;
        this.killstreak = 0;
        this.points = [{x: this.position.x, y: this.position.y}];
        this.newPoints = [];
        this.queuedPoints = [];
        this.talkStamina = 255;
        this.color = Math.random() * 360;
        this.length = defaultLength;



        lastEntityId++;
        snakes[this.id] = this;
        entities[this.id] = this;

        
        this.network.send(Bit8);

        queuedEntityRenders[this.id] = this;
        

        Object.values(snakes).forEach((snake) => {

            this.queuedEntityRenders[snake.id] = snake
        })
        Object.values(entities).forEach((food) => {
          this.queuedEntityRenders[food.id] = food
        });

        
    }
    updateLeaderboard() {
        var Bit8 = new DataView(new ArrayBuffer(1000));
        var offset = 0
        Bit8.setUint8(offset, MessageTypes.SendLeaderboard);
        offset += 1;
        let sortedSnakes = Object.values(snakes).sort((a, b) => {
            return b.length - a.length;
        });
        let myRank = 0;
        let curRank = 0
        Object.values(sortedSnakes).forEach((snake) => {
            curRank++
            snake.rank = curRank;
            if (snake.id == this.id)
                myRank = curRank;
            if (curRank == 1) {
                king = snake;
            }
            Bit8.setUint16(offset, snake.id, true);
            offset += 2;
            Bit8.setUint32(offset, (snake.length - defaultLength)*scoreMultiplier, true);
            offset += 4;
            for (var characterIndex = 0; characterIndex < snake.nick.length; characterIndex++) {
                Bit8.setUint16(offset + characterIndex * 2, snake.nick.charCodeAt(characterIndex), true);
            }
            offset = getNick(Bit8, offset).offset;
        })
        Bit8.setUint16(offset, 0, true);
        offset += 2;
        Bit8.setUint16(offset, this.id, true);
        offset += 2;
        Bit8.setUint32(offset, (this.length - defaultLength)*scoreMultiplier, true);
        offset += 4;
        // Set rank
        // Sort snakes
        Bit8.setUint16(offset, myRank, true);
        offset += 2;

        this.network.send(Bit8);
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
        if (this.direction == direction) {
            return;
        }
        this.position[whatVector] = vector;
        /*if (this.points[0].x == this.position.x && this.points[0].y == this.position.y) {
            console.log("Attempting to add diagonal point");
            return
        }*/
        this.direction = direction;
        this.addPoint(this.position.x, this.position.y);
        queuedEntityUpdates[this.id] = this;
    }
    rubAgainst(snake, distance) {
        this.flags |= EntityFlags.IsRubbing;
        this.RubSnake = snake.id;

        let rubSpeed = 4/distance
        if (rubSpeed > 4)
            rubSpeed = 4
        this.extraSpeed += rubSpeed
        //if (this.extraSpeed > maxBoostSpeed)
            //this.extraSpeed = maxBoostSpeed;
        this.speed = 0.25 + this.extraSpeed / (255 * UPDATE_EVERY_N_TICKS);
    }
    stopRubbing() {
        this.flags &= ~EntityFlags.IsRubbing;
        this.RubSnake = null;
        if (this.extraSpeed > 0)
            this.extraSpeed -= 1
        this.speed = 0.25 + this.extraSpeed / (255 * UPDATE_EVERY_N_TICKS);
    }
    kill(reason, killedByID) {
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

            offset = getNick(Bit8, offset).offset;
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
            offset = getNick(Bit8, offset).offset;
            this.network.send(Bit8);
        }
        delete this.loadedEntities[this.id]
        // Update other snakes
        
        if (!this.spawned) {
            return
        }
        Object.values(clients).forEach((snake) => {
            //if (snake.id != this.id) {
            console.log("Deleting snake " + this.id + " from " + snake.id)
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
            //}
        });


        // Every 5 unit convert to 1 food

        let actualLength = 0
        for (let i = -1; i < this.points.length - 1; i++) {
          let point;
          if (i == -1) point = this.position;
          else point = this.points[i];
          let nextPoint = this.points[i + 1];

          let segmentLength = getSegmentLength(point, nextPoint);
          actualLength += segmentLength;
        }

        //for (let i = 0; i < actualLength; i+=2) {
        for (let i = 0; i < actualLength; i+=1) {
            let point = getPointAtDistance(this, i);

            new Food(point.x, point.y, this.color - 25 +Math.random()*50, this);

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
            if (entity.position && entity.spawned) {
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
                        this.loadedEntities[entity.id] = entity;
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
            if (entity.position  && entity.spawned) {
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


                        break;
                    case UpdateTypes.OnRemove:
                        Bit8.setUint16(offset, entity.id, true);
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
    DrawDebugCircle(x, y, color) {
        var Bit8 = new DataView(new ArrayBuffer(49));
        var offset = 0;
        Bit8.setUint8(offset, 0xa7);
        offset += 1;
        Bit8.setUint16(offset, 1, true);
        offset += 2;
        Bit8.setFloat32(offset, x, true);
        offset += 4;
        Bit8.setFloat32(offset, y, true);
        offset += 4;
        Bit8.setUint16(offset, color, true);
        this.network.send(Bit8);

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
                var nick = getNick(view, 1);
                console.log("Spawning snake " + nick.nick);
                if (!this.spawned)
                    this.spawn(nick.nick);
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
        }
    }

}


let newSnakes = [];

function round(num) {
    return Math.round(num / 1000) * 1000
}
class Client extends EventEmitter {
    constructor(websocket) {
        super();
        this.socket = websocket;
        this.nick = "";
        this.id = 0;
        this.windowSizeX = 0;
        this.windowSizeY = 0;
    }
}




function getNick(data, bitOffset) {
    var nick = "";
    while (true) {
        var charCode = data.getUint16(bitOffset, true);
        bitOffset += 2;
        if (0 == charCode) break;
        nick += String.fromCharCode(charCode);
    }
    return { nick: nick, offset: bitOffset };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
if (wssSecure) {
    wssSecure.on('connection', async function connection(ws) {
        let client = new Client(ws);
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

wss.on('connection', async function connection(ws) {
    let client = new Client(ws);
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
    Object.values(snakes).forEach(function (snake) {
        let Bit8 = new DataView(new ArrayBuffer(1));
        Bit8.setUint8(0, 0xa8);
        snake.network.send(Bit8);
        
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
        Object.values(snakes).forEach(function (otherSnake) {
            // Check if head of snake of near body of other snake
            let closestRubLine
            for (let i = -1; i < otherSnake.points.length - 1; i++) {
                let point, nextPoint;
                if (i == -1)
                    point = otherSnake.position;
                else
                    point = otherSnake.points[i];
                nextPoint = otherSnake.points[i + 1];

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
                            if (data.distance >= 3)
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
        queuedEntityUpdates[snake.id] = snake;
    });
}

function entitiesNearSnake(snake, radius) { // Returns entities near snake and loaded entities that are not in radius
    let entitiesInRadius = entitiesWithinRadius([snake.position.x, snake.position.y], Object.values(entities), radius);
    let loadedEntities = Object.values(snake.loadedEntities);
    let entitiesToAdd = entitiesInRadius.filter(entity => !loadedEntities.includes(entity));
    let entitiesToRemove = loadedEntities.filter(entity => !entitiesInRadius.includes(entity));
    return { entitiesToAdd, entitiesToRemove };
}

async function main() {
    UpdateArena()

    Object.values(clients).forEach(function (snake) {
        if (snake.spawned) {
            Object.values(entities).forEach(function (food) {
                if (food.type == EntityTypes.Item) {
                    // Check if snake is near food
                    let distance = Math.sqrt(
                        Math.pow(snake.position.x - food.position.x, 2) +
                        Math.pow(snake.position.y - food.position.y, 2)
                    );
                    if (distance < 4) {
                        food.eat(snake);
                    }
                }
            });
            if (snake.talkStamina < 255) {
                snakes[snake.id].talkStamina += 5;
                if (snake.talkStamina > 255)
                    snakes[snake.id].talkStamina = 255;
            }
        }
    })
    
    
    
    Object.values(snakes).forEach(function (snake) {

        /* CALCULATE TAIL LENGTH */
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
        }
        if (totalPointLength > snake.length) {
            let secondToLastPoint = snake.points[snake.points.length - 2] || snake.position;
            let lastPoint = snake.points[snake.points.length - 1] || snake.position;
            let direction = getNormalizedDirection(secondToLastPoint, lastPoint);

            let amountOverLength = totalPointLength - snake.length;
            let lastSegmentLength = getSegmentLength(secondToLastPoint, lastPoint);

            if (lastSegmentLength > amountOverLength) { // Last segment can be decreased to fit length
                let newPoint = {
                    x: lastPoint.x - direction.x * amountOverLength,
                    y: lastPoint.y - direction.y * amountOverLength
                }
                snake.points[snake.points.length - 1] = newPoint;
            } else { // Last segment is too short, remove it and decrease the next one
                snake.points.pop();
            }
        }
        //
    })

    // Add random food spawns
    let maxFood = arenaSize ^ 2 / 60;
    let foodSpawnPercent = (arenaSize ^ 2) / 10;
    if (Object.keys(entities).length < maxFood) {
        if (Math.random()*100 < foodSpawnPercent) {
            new Food();
        }
        
    }

    Object.values(clients).forEach(function (snake) {
        if (snake.id) {
            let entQuery = entitiesNearSnake(snake, 50);
            let nearbyEntities = entQuery.entitiesToAdd;
            let removeEntities = entQuery.entitiesToRemove;

            //if (snake && !snake.loadedEntities[snake.id])
                //nearbyEntities.unshift(snake)
            snake.update(UpdateTypes.OnRender, nearbyEntities);
            snake.update(UpdateTypes.OnRemove, removeEntities)

            Object.values(snake.loadedEntities).forEach(function (entity) {
                if (entity.type == EntityTypes.Player)
                    snake.update(UpdateTypes.OnUpdate, [entity]);
            })
        }
    })
    Object.values(snakes).forEach(function (snake) {
        snake.updateLeaderboard();
        snake.newPoints = []
    })
    queuedEntityRenders = {};
    queuedEntityUpdates = {};






    setTimeout(() => {
        main()
    }, updateDuration);
}

main()