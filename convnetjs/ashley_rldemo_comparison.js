var environments = [];

////////////////////////////////////////////////////////

// A 2D vector utility
var Vec = function(x, y) {
    this.x = x;
    this.y = y;
};
Vec.prototype = {

    // utilities
    dist_from: function(v) { return Math.sqrt(Math.pow(this.x-v.x,2) + Math.pow(this.y-v.y,2)); },
    length: function() { return Math.sqrt(Math.pow(this.x,2) + Math.pow(this.y,2)); },

    // new vector returning operations
    add: function(v) { return new Vec(this.x + v.x, this.y + v.y); },
    sub: function(v) { return new Vec(this.x - v.x, this.y - v.y); },
    rotate: function(a) {  // CLOCKWISE
        return new Vec(this.x * Math.cos(a) + this.y * Math.sin(a),
            -this.x * Math.sin(a) + this.y * Math.cos(a));
    },

    // in place operations
    scale: function(s) { this.x *= s; this.y *= s; },
    normalize: function() { var d = this.length(); this.scale(1.0/d); }
};

// line intersection helper function: does line segment (p1,p2) intersect segment (p3,p4) ?
var line_intersect = function(p1,p2,p3,p4) {
    var denom = (p4.y-p3.y)*(p2.x-p1.x)-(p4.x-p3.x)*(p2.y-p1.y);
    if(denom===0.0) { return false; } // parallel lines
    var ua = ((p4.x-p3.x)*(p1.y-p3.y)-(p4.y-p3.y)*(p1.x-p3.x))/denom;
    var ub = ((p2.x-p1.x)*(p1.y-p3.y)-(p2.y-p1.y)*(p1.x-p3.x))/denom;
    if(ua>0.0&&ua<1.0&&ub>0.0&&ub<1.0) {
        var up = new Vec(p1.x+ua*(p2.x-p1.x), p1.y+ua*(p2.y-p1.y));
        return {ua:ua, ub:ub, up:up}; // up is intersection point
    }
    return false;
};

var line_point_intersect = function(p1,p2,p0,rad) {
    var v = new Vec(p2.y-p1.y,-(p2.x-p1.x)); // perpendicular vector
    var d = Math.abs((p2.x-p1.x)*(p1.y-p0.y)-(p1.x-p0.x)*(p2.y-p1.y));
    d = d / v.length();
    if(d > rad) { return false; }

    v.normalize();
    v.scale(d);
    var up = p0.add(v);
    if(Math.abs(p2.x-p1.x)>Math.abs(p2.y-p1.y)) {
        var ua = (up.x - p1.x) / (p2.x - p1.x);
    } else {
        var ua = (up.y - p1.y) / (p2.y - p1.y);
    }
    if(ua>0.0&&ua<1.0) {
        return {ua:ua, up:up};
    }
    return false;
};

// Wall is made up of two points
var Wall = function(p1, p2) {
    this.p1 = p1;
    this.p2 = p2;
};

// World object contains many agents and walls and food and stuff
var util_add_box = function(lst, x, y, w, h) {
    lst.push(new Wall(new Vec(x,y), new Vec(x+w,y)));
    lst.push(new Wall(new Vec(x+w,y), new Vec(x+w,y+h)));
    lst.push(new Wall(new Vec(x+w,y+h), new Vec(x,y+h)));
    lst.push(new Wall(new Vec(x,y+h), new Vec(x,y)));
};

// item is circle thing on the floor that agent can interact with (see or eat, etc)
var Item = function(x, y, type) {
    this.p = new Vec(x, y); // position
    this.type = type;
    this.rad = 10; // default radius
    this.age = 0;
    this.cleanup_ = false;
};

////////////////////////////////////////////////////////

var World = function( canvas ) {
    this.agents = [];
    this.canvas = canvas;
    this.ctx = this.canvas.getContext("2d");
    this.W = this.canvas.width;
    this.H = this.canvas.height;

    this.clock = 0;

    // set up walls in the world
    this.walls = [];
    var pad = 10;
    util_add_box(this.walls, pad, pad, this.W-pad*2, this.H-pad*2);
    util_add_box(this.walls, 100/1.55, 100/1.55, 200/1.55, 300/1.55); // inner walls
    this.walls.pop();
    util_add_box(this.walls, 400/1.55, 100/1.55, 200/1.55, 300/1.55);
    this.walls.pop();

    // set up food and poison
    this.items = [];
    for(var k=0;k<15;k++) {
        var x = convnetjs.randf(20, this.W-20);
        var y = convnetjs.randf(20, this.H-20);
        var t = convnetjs.randi(1, 3); // food or poison (1 and 2)
        var it = new Item(x, y, t);
        this.items.push(it);
    }
};

World.prototype = {
    // helper function to get closest colliding walls/items
    stuff_collide_: function(p1, p2, check_walls, check_items) {
        var minres = false;

        // collide with walls
        if(check_walls) {
            for(var i=0,n=this.walls.length;i<n;i++) {
                var wall = this.walls[i];
                var res = line_intersect(p1, p2, wall.p1, wall.p2);
                if(res) {
                    res.type = 0; // 0 is wall
                    if(!minres) { minres=res; }
                    else {
                        // check if its closer
                        if(res.ua < minres.ua) {
                            // if yes replace it
                            minres = res;
                        }
                    }
                }
            }
        }

        // collide with items
        if(check_items) {
            for(var i=0,n=this.items.length;i<n;i++) {
                var it = this.items[i];
                var res = line_point_intersect(p1, p2, it.p, it.rad);
                if(res) {
                    res.type = it.type; // store type of item
                    if(!minres) { minres=res; }
                    else { if(res.ua < minres.ua) { minres = res; }
                    }
                }
            }
        }

        return minres;
    },
    tick: function() {
        // tick the environment
        this.clock++;

        // fix input to all agents based on environment
        // process eyes
        this.collpoints = [];
        for(var i=0,n=this.agents.length;i<n;i++) {
            var a = this.agents[i];
            for(var ei=0,ne=a.eyes.length;ei<ne;ei++) {
                var e = a.eyes[ei];
                // we have a line from p to p->eyep
                var eyep = new Vec(a.p.x + e.max_range * Math.sin(a.angle + e.angle),
                    a.p.y + e.max_range * Math.cos(a.angle + e.angle));
                var res = this.stuff_collide_(a.p, eyep, true, true);
                if(res) {
                    // eye collided with wall
                    e.sensed_proximity = res.up.dist_from(a.p);
                    e.sensed_type = res.type;
                } else {
                    e.sensed_proximity = e.max_range;
                    e.sensed_type = -1;
                }
            }
        }

        // let the agents behave in the world based on their input
        for(var i=0,n=this.agents.length;i<n;i++) {
            this.agents[i].forward();
        }

        // apply outputs of agents on evironment
        for(var i=0,n=this.agents.length;i<n;i++) {
            var a = this.agents[i];
            a.op = a.p; // back up old position
            a.oangle = a.angle; // and angle

            // steer the agent according to outputs of wheel velocities
            var v = new Vec(0, a.rad / 2.0);
            v = v.rotate(a.angle + Math.PI/2);
            var w1p = a.p.add(v); // positions of wheel 1 and 2
            var w2p = a.p.sub(v);
            var vv = a.p.sub(w2p);
            vv = vv.rotate(-a.rot1);
            var vv2 = a.p.sub(w1p);
            vv2 = vv2.rotate(a.rot2);
            var np = w2p.add(vv);
            np.scale(0.5);
            var np2 = w1p.add(vv2);
            np2.scale(0.5);
            a.p = np.add(np2);

            a.angle -= a.rot1;
            if(a.angle<0)a.angle+=2*Math.PI;
            a.angle += a.rot2;
            if(a.angle>2*Math.PI)a.angle-=2*Math.PI;

            // agent is trying to move from p to op. Check walls
            var res = this.stuff_collide_(a.op, a.p, true, false);
            if(res) {
                // wall collision! reset position
                a.p = a.op;
            }

            // handle boundary conditions
            if(a.p.x<0)a.p.x=0;
            if(a.p.x>this.W)a.p.x=this.W;
            if(a.p.y<0)a.p.y=0;
            if(a.p.y>this.H)a.p.y=this.H;
        }

        // tick all items
        var update_items = false;
        for(var i=0,n=this.items.length;i<n;i++) {
            var it = this.items[i];
            it.age += 1;

            // see if some agent gets lunch
            for(var j=0,m=this.agents.length;j<m;j++) {
                var a = this.agents[j];
                var d = a.p.dist_from(it.p);
                if(d < it.rad + a.rad) {

                    // wait lets just make sure that this isn't through a wall
                    var rescheck = this.stuff_collide_(a.p, it.p, true, false);
                    if(!rescheck) {
                        // ding! nom nom nom
                        if(it.type === 1) a.digestion_signal += 5.0; // mmm delicious apple
                        if(it.type === 2) a.digestion_signal += -6.0; // ewww poison
                        it.cleanup_ = true;
                        update_items = true;
                        break; // break out of loop, item was consumed
                    }
                }
            }

            if(it.age > 5000 && this.clock % 100 === 0 && convnetjs.randf(0,1)<0.1) {
                it.cleanup_ = true; // replace this one, has been around too long
                update_items = true;
            }
        }
        if(update_items) {
            var nt = [];
            for(var i=0,n=this.items.length;i<n;i++) {
                var it = this.items[i];
                if(!it.cleanup_) nt.push(it);
            }
            this.items = nt; // swap
        }
        if(this.items.length < 30 && this.clock % 10 === 0 && convnetjs.randf(0,1)<0.25) {
            var newitx = convnetjs.randf(20, this.W-20);
            var newity = convnetjs.randf(20, this.H-20);
            var newitt = convnetjs.randi(1, 3); // food or poison (1 and 2)
            var newit = new Item(newitx, newity, newitt);
            this.items.push(newit);
        }

        // agents are given the opportunity to learn based on feedback of their action on environment
        for(var i=0,n=this.agents.length;i<n;i++) {
            this.agents[i].backward();
        }
    },
    // Draw everything
    draw: function() {
        this.ctx.clearRect(0, 0, this.W, this.H);
        this.ctx.lineWidth = 1;
        var agents = this.agents;

        // draw walls in environment
        this.ctx.strokeStyle = "rgb(0,0,0)";
        this.ctx.beginPath();
        for(var i=0,n=this.walls.length;i<n;i++) {
            var q = this.walls[i];
            this.ctx.moveTo(q.p1.x, q.p1.y);
            this.ctx.lineTo(q.p2.x, q.p2.y);
        }
        this.ctx.stroke();

        // draw agents
        for(var i=0,n=this.agents.length;i<n;i++) {
            var a = this.agents[i];
            //var r = Math.floor(a.brain.latest_reward * 200);
            //if(r>255)r=255;if(r<0)r=0;
            //ctx.fillStyle = "rgb(" + r + ", 150, 150)";
            this.ctx.fillStyle = a.colour;
            this.ctx.strokeStyle = "rgb(0,0,0)";

            // draw agents body
            this.ctx.beginPath();
            this.ctx.arc(a.op.x, a.op.y, a.rad, 0, Math.PI*2, true);
            this.ctx.fill();
            this.ctx.stroke();

            // draw agents sight
            for(var ei=0,ne=a.eyes.length;ei<ne;ei++) {
                var e = a.eyes[ei];
                var sr = e.sensed_proximity;
                if(e.sensed_type === -1 || e.sensed_type === 0) {
                    this.ctx.strokeStyle = "rgb(0,0,0)"; // wall or nothing
                }
                if(e.sensed_type === 1) { this.ctx.strokeStyle = "rgb(255,150,150)"; } // apples
                if(e.sensed_type === 2) { this.ctx.strokeStyle = "rgb(255,255,0)"; } // poison
                this.ctx.beginPath();
                this.ctx.moveTo(a.op.x, a.op.y);
                this.ctx.lineTo(a.op.x + sr * Math.sin(a.oangle + e.angle),
                    a.op.y + sr * Math.cos(a.oangle + e.angle));
                this.ctx.stroke();
            }
        }

        // draw items
        this.ctx.strokeStyle = "rgb(0,0,0)";
        for(var i=0,n=this.items.length;i<n;i++) {
            var it = this.items[i];
            if(it.type === 1) this.ctx.fillStyle = "rgb(255, 150, 150)";
            if(it.type === 2) this.ctx.fillStyle = "rgb(255, 255, 0)";
            this.ctx.beginPath();
            this.ctx.arc(it.p.x, it.p.y, it.rad, 0, Math.PI*2, true);
            this.ctx.fill();
            this.ctx.stroke();
        }

        //w.agents[1].brain.visSelf(document.getElementById('brain_info_div'));
    }
}

////////////////////////////////////////////////////////

// Eye sensor has a maximum range and senses walls
var Eye = function(angle) {
    this.angle = angle; // angle relative to agent its on
    this.max_range = 85/1.55;
    this.sensed_proximity = 85/2; // what the eye is seeing. will be set in world.tick()
    this.sensed_type = -1; // what does the eye see?
};

////////////////////////////////////////////////////////

// A single agent
var Agent = function(behavior, colour) {

    // positional information
    this.p = new Vec(30, 30);
    this.op = this.p; // old position
    this.angle = 0; // direction facing

    this.actions = [];
    this.actions.push([1,1]);
    this.actions.push([0.8,1]);
    this.actions.push([1,0.8]);
    this.actions.push([0.5,0]);
    this.actions.push([0,0.5]);

    // properties
    this.rad = 10;
    this.eyes = [];
    for(var k=0;k<9;k++) { this.eyes.push(new Eye((k-3)*0.25)); }

    // braaain
    //this.brain = new deepqlearn.Brain(this.eyes.length * 3, this.actions.length);
    var spec;
    if(behavior == 'greedy') {
        spec = document.getElementById('qspec_greedy').value;
    } else if(behavior == 'thompson') {
        spec = document.getElementById('qspec_thompson').value;
    }
    eval(spec);
    this.brain = brain;
    this.colour = colour;
    
    this.digestion_signal = 0.0;

    // outputs on world
    this.rot1 = 0.0; // rotation speed of 1st wheel
    this.rot2 = 0.0; // rotation speed of 2nd wheel
};
Agent.prototype = {
    forward: function() {
        // in forward pass the agent simply behaves in the environment
        // create input to brain
        var num_eyes = this.eyes.length;
        var input_array = new Array(num_eyes * 3);
        for(var i=0;i<num_eyes;i++) {
            var e = this.eyes[i];
            input_array[i*3] = 1.0;
            input_array[i*3+1] = 1.0;
            input_array[i*3+2] = 1.0;
            if(e.sensed_type !== -1) {
                // sensed_type is 0 for wall, 1 for food and 2 for poison.
                // lets do a 1-of-k encoding into the input array
                input_array[i*3 + e.sensed_type] = e.sensed_proximity/e.max_range; // normalize to [0,1]
            }
        }

        // get action from brain
        var actionix = this.brain.forward(input_array);
        var action = this.actions[actionix];
        this.actionix = actionix; //back this up

        // demultiplex into behavior variables
        this.rot1 = action[0]*1;
        this.rot2 = action[1]*1;

        //this.rot1 = 0;
        //this.rot2 = 0;
    },
    backward: function() {
        // in backward pass agent learns.
        // compute reward
        var proximity_reward = 0.0;
        var num_eyes = this.eyes.length;
        for(var i=0;i<num_eyes;i++) {
            var e = this.eyes[i];
            // agents dont like to see walls, especially up close
            proximity_reward += e.sensed_type === 0 ? e.sensed_proximity/e.max_range : 1.0;
        }
        proximity_reward = proximity_reward/num_eyes;
        //proximity_reward = Math.min(1.0, proximity_reward * 2); // seems to encourage agent to get stuck in walls at 90 degrees angle

        // agents like to go straight forward
        var forward_reward = 0.0;
        if(this.actionix === 0 && proximity_reward > 0.75) forward_reward = 0.1 * proximity_reward;

        // agents like to eat good things
        var digestion_reward = this.digestion_signal;
        this.digestion_signal = 0.0;

        var reward = proximity_reward + forward_reward + digestion_reward;

        // pass to brain for learning
        this.brain.backward(reward);
    }
};

////////////////////////////////////////////////////////

function draw_stats() {
    for( var i = 0; i < environments.length; ++i ) {
        var w = environments[ i ];
        if (w.clock % 500 === 0) {
            var yl = Array(2);
            for (var j = 0; j < w.agents.length; ++j) {
                var a = w.agents[j];
                var b = a.brain;
                yl[i] = b.average_reward_window.get_average()
            }
            reward_graph.add(w.clock / 500, yl);
            var gcanvas = document.getElementById("graph_canvas");
            reward_graph.drawSelf(gcanvas);
        }
    }
}

// Tick the world
function tick() {
    environments.forEach( function( w ) {
        w.tick();
        if(!skipdraw && w.clock % 100 == 0 ){ // If we're meant NOT to skip, draw often
            w.draw();
        }
        else if( skipdraw && w.clock % 1000 == 0 ){ // Otherwise, draw infrequently.
            w.draw();
        }

        if( w.clock % 200 === 0 ) { // Always update the graph!
            draw_stats();
        }

    });
}

var simspeed = 2;
function goveryfast() {
    window.clearInterval(current_interval_id);
    current_interval_id = setInterval(tick, 0);
    skipdraw = true;
    simspeed = 3;
}
function gofast() {
    window.clearInterval(current_interval_id);
    current_interval_id = setInterval(tick, 0);
    skipdraw = false;
    simspeed = 2;
}
function gonormal() {
    window.clearInterval(current_interval_id);
    current_interval_id = setInterval(tick, 30);
    skipdraw = false;
    simspeed = 1;
}

var reward_graph;
var current_interval_id;
var skipdraw = false;

function start() {

    environments = [];
    environments.push(
        new World( document.getElementById("canvas_1"))
    );

    environments.push(
        new World( document.getElementById("canvas_2"))
    );

    environments[ 0 ].agents = [ new Agent('thompson', 'rgb(0,0,255')];
    environments[ 1 ].agents = [ new Agent('greedy', 'rgb(0,255,0')];

    reward_graph = new cnnvis.MultiGraph(['Thompson', 'Greedy'], {styles: ['rgb(0,0,255)', 'rgb(0,255,0)'],
        shaded: 3000 / 500});

    gofast();
}
function stop() {
    window.clearInterval(current_interval_id);
    environments.forEach( function( e ) {
        e.ctx.clearRect(0, 0, e.W, e.H);
    });
    var gcanvas = document.getElementById("graph_canvas");
    gcanvas.getContext("2d").clearRect(0, 0, gcanvas.width, gcanvas.height);
}