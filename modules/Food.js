const Enums = require("./Enums.js");
const MapFunctions = require("./MapFunctions.js");

class Food {
    type = Enums.EntityTypes.ENTITY_ITEM;
    subtype = Enums.EntitySubtypes.SUB_ENTITY_ITEM_FOOD;
    position = { x: 0, y: 0 };
    spawned = true
    value = foodValue*2;
    lastUpdate = Date.now();
    constructor(x, y, color, origin, timeToLive = 5000 + (Math.random() * 60 * 1000 * 5)) {
        let thisId = entityIDs.allocateID();
        entities[thisId] = this;
        if (x == undefined) 
            this.position = MapFunctions.GetRandomPosition();
        else {
            this.position = { x: x, y: y };
        }
        if (color == undefined) this.color = Math.random() * 360;
        else this.color = color;
        this.id = thisId;
        if (origin)
            this.origin = origin.id;
        
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
                    Bit8.setUint8(0, Enums.ServerToClient.OPCODE_ENTITY_INFO);
                    var offset = 1;
                    Bit8.setUint16(offset, this.id, true);
                    offset += 2;
                    Bit8.setUint8(offset, Enums.UpdateTypes.UPDATE_TYPE_DELETE, true);
                    offset += 1;
                    Bit8.setUint16(offset, snake && snake.id || 0, true);
                    offset += 2;
                    Bit8.setUint8(offset, Enums.KillReasons.KILLED, true);
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
        entityIDs.releaseID(this.id);
        delete entities[this.id]; 
    }
}

module.exports = Food;