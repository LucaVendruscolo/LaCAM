const AGENT_COLORS = ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff'];

class Graph {
    constructor() {
        this.vertices = new Map();
        this.edges = new Map();
        this.adjacency = new Map();
        this.nextVertexId = 0;
        this.nextEdgeId = 0;
    }

    addVertex(x, y) {
        const id = this.nextVertexId++;
        const label = String.fromCharCode(97 + id);
        this.vertices.set(id, { id, x, y, label });
        this.adjacency.set(id, new Set());
        return id;
    }

    removeVertex(id) {
        const toRemove = [];
        this.edges.forEach((edge, edgeId) => {
            if (edge.v1 === id || edge.v2 === id) {
                toRemove.push(edgeId);
            }
        });
        toRemove.forEach(edgeId => this.removeEdge(edgeId));
        this.adjacency.delete(id);
        this.adjacency.forEach(neighbors => neighbors.delete(id));
        this.vertices.delete(id);
    }

    addEdge(v1, v2) {
        if (v1 === v2) return null;
        for (const [id, edge] of this.edges) {
            if ((edge.v1 === v1 && edge.v2 === v2) || (edge.v1 === v2 && edge.v2 === v1)) {
                return null;
            }
        }
        const id = this.nextEdgeId++;
        this.edges.set(id, { id, v1, v2 });
        this.adjacency.get(v1).add(v2);
        this.adjacency.get(v2).add(v1);
        return id;
    }

    removeEdge(id) {
        const edge = this.edges.get(id);
        if (edge) {
            this.adjacency.get(edge.v1)?.delete(edge.v2);
            this.adjacency.get(edge.v2)?.delete(edge.v1);
            this.edges.delete(id);
        }
    }

    getNeighbors(vertexId) {
        return this.adjacency.get(vertexId) || new Set();
    }

    getVertexLabel(id) {
        return this.vertices.get(id)?.label || '?';
    }

    clear() {
        this.vertices.clear();
        this.edges.clear();
        this.adjacency.clear();
        this.nextVertexId = 0;
        this.nextEdgeId = 0;
    }

    clone() {
        const g = new Graph();
        g.vertices = new Map(this.vertices);
        g.edges = new Map(this.edges);
        g.adjacency = new Map();
        this.adjacency.forEach((set, key) => {
            g.adjacency.set(key, new Set(set));
        });
        g.nextVertexId = this.nextVertexId;
        g.nextEdgeId = this.nextEdgeId;
        return g;
    }
}

class Agent {
    constructor(id, startVertexId = null, goalVertexId = null) {
        this.id = id;
        this.start = startVertexId;
        this.goal = goalVertexId;
        this.color = AGENT_COLORS[id % AGENT_COLORS.length];
    }

    clone() {
        const a = new Agent(this.id, this.start, this.goal);
        a.color = this.color;
        return a;
    }
}

class Configuration {
    constructor(locations) {
        this.locations = [...locations];
        this._hash = null;
    }

    get(agentId) {
        return this.locations[agentId];
    }

    hash() {
        if (this._hash === null) {
            this._hash = this.locations.join(',');
        }
        return this._hash;
    }

    equals(other) {
        return this.hash() === other.hash();
    }

    clone() {
        return new Configuration([...this.locations]);
    }

    toString(graph) {
        return '(' + this.locations.map(v => graph.getVertexLabel(v)).join(',') + ')';
    }
}

let hlNodeIdCounter = 0;
class HighLevelNode {
    constructor(config, parent = null) {
        this.id = hlNodeIdCounter++;
        this.config = config;
        this.tree = [];
        this.treeRoot = null;
        this.order = [];
        this.parent = parent;
    }

    clone() {
        const n = new HighLevelNode(this.config.clone(), null);
        n.id = this.id;
        n.order = [...this.order];
        return n;
    }
}

let llNodeIdCounter = 0;
class LowLevelNode {
    constructor(parent = null, who = null, where = null) {
        this.id = llNodeIdCounter++;
        this.parent = parent;
        this.who = who;
        this.where = where;
        this.children = [];
        this.depth = parent ? parent.depth + 1 : 0;
        this.isSearched = false;
        this.isSelected = false;
    }

    getConstraints() {
        const constraints = new Map();
        let node = this;
        while (node && node.who !== null) {
            constraints.set(node.who, node.where);
            node = node.parent;
        }
        return constraints;
    }

    getLabel(graph) {
        if (this.who === null) return 'root';
        return `${this.who + 1}→${graph.getVertexLabel(this.where)}`;
    }
}

class LaCAM {
    constructor(graph, agents) {
        this.graph = graph;
        this.agents = agents;
        this.state = null;
        this.history = [];
    }

    initialize() {
        hlNodeIdCounter = 0;
        llNodeIdCounter = 0;

        this.state = {
            open: [],
            explored: new Map(),
            currentHighLevelNode: null,
            currentLowLevelNode: null,
            generatedConfig: null,
            stepNumber: 0,
            phase: 'init',
            description: 'Algorithm initialized with start configuration',
            status: 'running',
            solution: null,
            nodesGenerated: 1,
            configurationsExplored: 1
        };

        const startLocations = this.agents.map(a => a.start);
        const startConfig = new Configuration(startLocations);
        const Cinit = new LowLevelNode(null, null, null);
        const Ninit = new HighLevelNode(startConfig, null);
        Ninit.treeRoot = Cinit;
        Ninit.tree = [Cinit];
        Ninit.order = this.getInitOrder();

        this.state.open.push(Ninit);
        this.state.explored.set(startConfig.hash(), Ninit);
        this.state.currentHighLevelNode = Ninit;
        this.state.phase = 'select';

        this.history = [];
        this.saveHistory();
    }

    getInitOrder() {
        return [...this.agents]
            .map(a => ({
                id: a.id,
                dist: this.getDistance(a.start, a.goal)
            }))
            .sort((a, b) => b.dist - a.dist)
            .map(a => a.id);
    }

    getOrder(config) {
        return [...this.agents]
            .map(a => ({
                id: a.id,
                atGoal: config.get(a.id) === a.goal,
                dist: this.getDistance(config.get(a.id), a.goal)
            }))
            .sort((a, b) => {
                if (a.atGoal !== b.atGoal) return a.atGoal ? 1 : -1;
                return b.dist - a.dist;
            })
            .map(a => a.id);
    }

    getDistance(from, to) {
        if (from === to) return 0;
        if (from === null || to === null) return Infinity;

        const visited = new Set([from]);
        const queue = [{ vertex: from, dist: 0 }];

        while (queue.length > 0) {
            const { vertex, dist } = queue.shift();
            if (vertex === to) return dist;

            for (const neighbor of this.graph.getNeighbors(vertex)) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ vertex: neighbor, dist: dist + 1 });
                }
            }
        }
        return Infinity;
    }

    step() {
        if (this.state.status !== 'running') return false;

        this.saveHistory();
        this.state.stepNumber++;

        switch (this.state.phase) {
            case 'select':
                return this.stepSelect();
            case 'pop_constraint':
                return this.stepPopConstraint();
            case 'expand_tree':
                return this.stepExpandTree();
            case 'generate':
                return this.stepGenerate();
            case 'check':
                return this.stepCheck();
            default:
                return false;
        }
    }

    stepSelect() {
        if (this.state.open.length === 0) {
            this.state.status = 'no_solution';
            this.state.description = 'Open is empty - NO SOLUTION exists';
            return false;
        }

        const N = this.state.open[this.state.open.length - 1];
        this.state.currentHighLevelNode = N;

        const goalConfig = new Configuration(this.agents.map(a => a.goal));
        if (N.config.equals(goalConfig)) {
            this.state.solution = this.backtrack(N);
            this.state.status = 'solved';
            this.state.description = `GOAL REACHED! Solution found with ${this.state.solution.length} steps.`;
            return false;
        }

        if (N.tree.length === 0) {
            this.state.open.pop();
            this.state.description = `High-level node N${N.id} exhausted all constraints. Popped from Open.`;
            return true;
        }

        this.state.description = `Selected high-level node N${N.id} with config ${N.config.toString(this.graph)}`;
        this.state.phase = 'pop_constraint';
        return true;
    }

    stepPopConstraint() {
        const N = this.state.currentHighLevelNode;
        const C = N.tree.shift();
        C.isSelected = true;
        C.isSearched = true;
        this.state.currentLowLevelNode = C;

        const label = C.who === null ? 'root' : `agent ${C.who + 1} → ${this.graph.getVertexLabel(C.where)}`;
        this.state.description = `Popped constraint node [${label}] (depth ${C.depth})`;
        this.state.phase = 'expand_tree';
        return true;
    }

    stepExpandTree() {
        const N = this.state.currentHighLevelNode;
        const C = this.state.currentLowLevelNode;

        if (C.depth < this.agents.length) {
            const agentId = N.order[C.depth];
            const currentVertex = N.config.get(agentId);
            const neighbors = [...this.graph.getNeighbors(currentVertex)];

            const moves = [currentVertex, ...neighbors];
            for (const vertex of moves) {
                const Cnew = new LowLevelNode(C, agentId, vertex);
                C.children.push(Cnew);
                N.tree.push(Cnew);
            }

            const labels = moves.map(v => this.graph.getVertexLabel(v)).join(', ');
            this.state.description = `Expanded tree: agent ${agentId + 1} can go to [${labels}] (${moves.length} options)`;
        } else {
            this.state.description = `Constraint node at max depth - all agents have constraints assigned`;
        }

        this.state.phase = 'generate';
        return true;
    }

    stepGenerate() {
        const N = this.state.currentHighLevelNode;
        const C = this.state.currentLowLevelNode;

        const constraints = C.getConstraints();
        const Qnew = this.generateConfig(N.config, constraints);

        if (Qnew === null) {
            this.state.description = 'Failed to generate valid configuration (conflicts detected)';
            this.state.generatedConfig = null;
            this.state.phase = 'select';
            return true;
        }

        this.state.generatedConfig = Qnew;
        this.state.description = `Generated new configuration: ${Qnew.toString(this.graph)}`;
        this.state.phase = 'check';
        return true;
    }

    stepCheck() {
        const Qnew = this.state.generatedConfig;
        const N = this.state.currentHighLevelNode;

        if (this.state.explored.has(Qnew.hash())) {
            this.state.description = `Configuration ${Qnew.toString(this.graph)} already explored - skipping`;
            this.state.phase = 'select';
            return true;
        }

        const Cinit = new LowLevelNode(null, null, null);
        const Nnew = new HighLevelNode(Qnew, N);
        Nnew.treeRoot = Cinit;
        Nnew.tree = [Cinit];
        Nnew.order = this.getOrder(Qnew);

        this.state.open.push(Nnew);
        this.state.explored.set(Qnew.hash(), Nnew);

        this.state.nodesGenerated++;
        this.state.configurationsExplored++;

        this.state.description = `Created new high-level node N${Nnew.id} with config ${Qnew.toString(this.graph)}. Pushed to Open.`;
        this.state.phase = 'select';
        return true;
    }

    generateConfig(currentConfig, constraints) {
        const newLocations = new Array(this.agents.length);
        const occupiedNext = new Set();

        const constrainedAgents = [];
        const unconstrainedAgents = [];

        for (const agent of this.agents) {
            if (constraints.has(agent.id)) {
                constrainedAgents.push(agent);
            } else {
                unconstrainedAgents.push(agent);
            }
        }

        unconstrainedAgents.sort((a, b) => {
            const distA = this.getDistance(currentConfig.get(a.id), a.goal);
            const distB = this.getDistance(currentConfig.get(b.id), b.goal);
            return distB - distA;
        });

        for (const agent of constrainedAgents) {
            const nextPos = constraints.get(agent.id);
            if (occupiedNext.has(nextPos)) {
                return null;
            }
            newLocations[agent.id] = nextPos;
            occupiedNext.add(nextPos);
        }

        for (const agent of unconstrainedAgents) {
            const currentPos = currentConfig.get(agent.id);
            let nextPos = this.getBestMove(agent.id, currentPos, agent.goal, occupiedNext);

            if (nextPos === null) {
                return null;
            }

            newLocations[agent.id] = nextPos;
            occupiedNext.add(nextPos);
        }

        for (let i = 0; i < this.agents.length; i++) {
            for (let j = i + 1; j < this.agents.length; j++) {
                const currI = currentConfig.get(i);
                const currJ = currentConfig.get(j);
                const nextI = newLocations[i];
                const nextJ = newLocations[j];

                if (currI === nextJ && currJ === nextI) {
                    return null;
                }
            }
        }

        return new Configuration(newLocations);
    }

    getBestMove(agentId, current, goal, occupied) {
        if (current === goal && !occupied.has(current)) {
            return current;
        }

        const neighbors = [...this.graph.getNeighbors(current)];
        let bestMove = null;
        let bestDist = Infinity;

        if (!occupied.has(current)) {
            bestMove = current;
            bestDist = this.getDistance(current, goal);
        }

        for (const neighbor of neighbors) {
            if (!occupied.has(neighbor)) {
                const dist = this.getDistance(neighbor, goal);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestMove = neighbor;
                }
            }
        }

        return bestMove;
    }

    backtrack(node) {
        const path = [];
        let current = node;
        while (current) {
            path.unshift(current.config);
            current = current.parent;
        }
        return path;
    }

    stepBack() {
        if (this.history.length > 1) {
            this.history.pop();
            const prevSnapshot = this.history[this.history.length - 1];
            this.restoreFromSnapshot(prevSnapshot);
            return true;
        }
        return false;
    }

    saveHistory() {
        const snapshot = {
            nodes: this.cloneAllNodes(),
            openIds: this.state.open.map(n => n.id),
            exploredMap: new Map([...this.state.explored].map(([hash, node]) => [hash, node.id])),
            currentHighLevelNodeId: this.state.currentHighLevelNode?.id ?? null,
            currentLowLevelNodeId: this.state.currentLowLevelNode?.id ?? null,
            stepNumber: this.state.stepNumber,
            phase: this.state.phase,
            description: this.state.description,
            status: this.state.status,
            nodesGenerated: this.state.nodesGenerated,
            configurationsExplored: this.state.configurationsExplored,
            generatedConfig: this.state.generatedConfig ? this.state.generatedConfig.clone() : null,
            solution: this.state.solution ? this.state.solution.map(c => c.clone()) : null
        };
        this.history.push(snapshot);

        if (this.history.length > 200) {
            this.history.shift();
        }
    }

    cloneAllNodes() {
        const nodesMap = new Map();

        const cloneLowLevelTree = (node, parentClone = null) => {
            const clone = new LowLevelNode(parentClone, node.who, node.where);
            clone.id = node.id;
            clone.depth = node.depth;
            clone.isSearched = node.isSearched;
            clone.isSelected = node.isSelected;
            clone.children = node.children.map(child => cloneLowLevelTree(child, clone));
            return clone;
        };

        const allNodes = new Map();
        this.state.open.forEach(n => allNodes.set(n.id, n));
        this.state.explored.forEach(n => allNodes.set(n.id, n));

        allNodes.forEach((node, id) => {
            const clonedTreeRoot = node.treeRoot ? cloneLowLevelTree(node.treeRoot) : null;

            const clonedTree = [];
            if (clonedTreeRoot) {
                const queue = [clonedTreeRoot];
                while (queue.length > 0) {
                    const n = queue.shift();
                    const originalInTree = node.tree.some(t => t.id === n.id);
                    if (originalInTree) {
                        clonedTree.push(n);
                    }
                    n.children.forEach(c => queue.push(c));
                }
            }

            nodesMap.set(id, {
                id: node.id,
                config: node.config.clone(),
                treeRoot: clonedTreeRoot,
                tree: clonedTree,
                order: [...node.order],
                parentId: node.parent?.id ?? null
            });
        });

        return nodesMap;
    }

    restoreFromSnapshot(snapshot) {
        const nodeMap = new Map();

        snapshot.nodes.forEach((data, id) => {
            const node = new HighLevelNode(data.config, null);
            node.id = data.id;
            node.treeRoot = data.treeRoot;
            node.tree = data.tree;
            node.order = data.order;
            node._parentId = data.parentId;
            nodeMap.set(id, node);
        });

        nodeMap.forEach(node => {
            if (node._parentId !== null) {
                node.parent = nodeMap.get(node._parentId) || null;
            }
            delete node._parentId;
        });

        this.state.open = snapshot.openIds.map(id => nodeMap.get(id)).filter(n => n);

        this.state.explored = new Map();
        snapshot.exploredMap.forEach((nodeId, hash) => {
            const node = nodeMap.get(nodeId);
            if (node) {
                this.state.explored.set(hash, node);
            }
        });

        this.state.currentHighLevelNode = snapshot.currentHighLevelNodeId !== null
            ? nodeMap.get(snapshot.currentHighLevelNodeId)
            : null;

        this.state.currentLowLevelNode = null;
        if (snapshot.currentLowLevelNodeId !== null && this.state.currentHighLevelNode?.treeRoot) {
            const findLLNode = (node) => {
                if (node.id === snapshot.currentLowLevelNodeId) return node;
                for (const child of node.children) {
                    const found = findLLNode(child);
                    if (found) return found;
                }
                return null;
            };
            this.state.currentLowLevelNode = findLLNode(this.state.currentHighLevelNode.treeRoot);
        }

        this.state.stepNumber = snapshot.stepNumber;
        this.state.phase = snapshot.phase;
        this.state.description = snapshot.description;
        this.state.status = snapshot.status;
        this.state.nodesGenerated = snapshot.nodesGenerated;
        this.state.configurationsExplored = snapshot.configurationsExplored;
        this.state.generatedConfig = snapshot.generatedConfig;
        this.state.solution = snapshot.solution;
    }

    reset() {
        this.initialize();
    }

    getTreeSize() {
        if (!this.state.currentHighLevelNode) return 0;
        let count = 0;
        const countNodes = (node) => {
            count++;
            node.children.forEach(countNodes);
        };
        if (this.state.currentHighLevelNode.treeRoot) {
            countNodes(this.state.currentHighLevelNode.treeRoot);
        }
        return count;
    }

    getPhaseExplanation() {
        const phase = this.state.phase;
        const explanations = {
            'init': {
                name: 'Initialize',
                short: 'Setting up the algorithm',
                detail: 'Creating the initial high-level node with the start configuration. The Open stack contains only this starting node, and the constraint tree has just a root node.'
            },
            'select': {
                name: 'Select Node',
                short: 'Picking next node from Open stack',
                detail: 'HIGH-LEVEL SEARCH: Look at the top of the Open stack (depth-first). Check if this configuration is the goal. If the constraint tree is exhausted, pop this node and try the next one.'
            },
            'pop_constraint': {
                name: 'Pop Constraint',
                short: 'Getting next constraint from tree',
                detail: 'LOW-LEVEL SEARCH: Remove the front node from the constraint tree queue (breadth-first). This node specifies constraints that must be followed when generating the next configuration.'
            },
            'expand_tree': {
                name: 'Expand Tree',
                short: 'Adding child constraints',
                detail: 'LOW-LEVEL SEARCH: For the next agent in priority order, create child constraint nodes for each possible move (stay at current vertex OR move to any adjacent vertex). These are added to the tree queue.'
            },
            'generate': {
                name: 'Generate Config',
                short: 'Creating new configuration',
                detail: 'SUCCESSOR GENERATION: Build a new configuration following all constraints from root to current node. Unconstrained agents move greedily toward their goals. Check for vertex conflicts (two agents same location) and swap conflicts (agents exchanging positions).'
            },
            'check': {
                name: 'Check & Add',
                short: 'Validating new configuration',
                detail: 'DUPLICATE CHECK: If this configuration was already explored, skip it. Otherwise, create a new high-level node for this configuration and push it onto the Open stack. This new node will be selected next (depth-first).'
            }
        };
        return explanations[phase] || { name: phase, short: 'Unknown phase', detail: 'No explanation available.' };
    }
}

class App {
    constructor() {
        this.graph = new Graph();
        this.agents = [];
        this.selectedAgent = null;
        this.algorithm = null;
        this.isPlaying = false;
        this.playInterval = null;
        this.mode = 'edit';

        this.dpr = window.devicePixelRatio || 1;

        this.graphCanvas = document.getElementById('graphCanvas');
        this.graphCtx = this.setupCanvas(this.graphCanvas, 400, 350);

        this.treeCanvas = document.getElementById('treeCanvas');
        this.treeCtx = this.setupCanvas(this.treeCanvas, 350, 200);

        this.miniCanvas = document.getElementById('miniGraphCanvas');
        this.miniCtx = this.setupCanvas(this.miniCanvas, 150, 120);

        this.dragStart = null;
        this.dragEnd = null;
        this.hoveredVertex = null;

        this.initEventListeners();
        this.render();
    }

    setupCanvas(canvas, width, height) {
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        canvas.width = width * this.dpr;
        canvas.height = height * this.dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(this.dpr, this.dpr);
        return ctx;
    }

    initEventListeners() {
        this.graphCanvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
        this.graphCanvas.addEventListener('mousemove', (e) => this.onCanvasMouseMove(e));
        this.graphCanvas.addEventListener('mouseup', (e) => this.onCanvasMouseUp(e));
        this.graphCanvas.addEventListener('mouseleave', () => this.onCanvasMouseLeave());

        document.addEventListener('keydown', (e) => this.onKeyDown(e));

        document.querySelectorAll('input[name="mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.mode = e.target.value;
                this.updateInstructions();
            });
        });

        document.getElementById('clearGraphBtn').addEventListener('click', () => this.clearGraph());
        document.getElementById('addAgentBtn').addEventListener('click', () => this.addAgent());
        document.getElementById('removeAgentBtn').addEventListener('click', () => this.removeSelectedAgent());
        document.getElementById('initAlgorithmBtn').addEventListener('click', () => this.initAlgorithm());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetAlgorithm());
        document.getElementById('backBtn').addEventListener('click', () => this.stepBack());
        document.getElementById('stepBtn').addEventListener('click', () => this.stepForward());
        document.getElementById('playBtn').addEventListener('click', () => this.togglePlay());

        document.querySelectorAll('#exampleDropdown a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.loadExample(e.target.dataset.example);
            });
        });

        document.getElementById('speedSlider').addEventListener('input', (e) => {
            if (this.isPlaying) {
                this.stopPlay();
                this.startPlay();
            }
        });
    }

    onCanvasMouseDown(e) {
        const pos = this.getCanvasPos(e);
        const vertex = this.findVertexAt(pos.x, pos.y);

        if (this.mode === 'edit') {
            if (vertex !== null) {
                this.dragStart = vertex;
            } else {
                this.graph.addVertex(pos.x, pos.y);
                this.render();
            }
        } else if (this.mode === 'start' && this.selectedAgent !== null) {
            if (vertex !== null) {
                this.agents[this.selectedAgent].start = vertex;
                this.renderAgentsList();
                this.render();
            }
        } else if (this.mode === 'goal' && this.selectedAgent !== null) {
            if (vertex !== null) {
                this.agents[this.selectedAgent].goal = vertex;
                this.renderAgentsList();
                this.render();
            }
        }
    }

    onCanvasMouseMove(e) {
        const pos = this.getCanvasPos(e);
        this.hoveredVertex = this.findVertexAt(pos.x, pos.y);

        if (this.dragStart !== null) {
            this.dragEnd = pos;
            this.render();
        }
    }

    onCanvasMouseUp(e) {
        if (this.dragStart !== null && this.mode === 'edit') {
            const pos = this.getCanvasPos(e);
            const endVertex = this.findVertexAt(pos.x, pos.y);

            if (endVertex !== null && endVertex !== this.dragStart) {
                this.graph.addEdge(this.dragStart, endVertex);
            }
        }
        this.dragStart = null;
        this.dragEnd = null;
        this.render();
    }

    onCanvasMouseLeave() {
        this.hoveredVertex = null;
        this.dragStart = null;
        this.dragEnd = null;
        this.render();
    }

    onKeyDown(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (this.hoveredVertex !== null && this.mode === 'edit') {
                const inUse = this.agents.some(a => a.start === this.hoveredVertex || a.goal === this.hoveredVertex);
                if (!inUse) {
                    this.graph.removeVertex(this.hoveredVertex);
                    this.hoveredVertex = null;
                    this.render();
                }
            }
        }
    }

    getCanvasPos(e) {
        const rect = this.graphCanvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (400 / rect.width),
            y: (e.clientY - rect.top) * (350 / rect.height)
        };
    }

    findVertexAt(x, y, radius = 20) {
        for (const [id, v] of this.graph.vertices) {
            const dx = v.x - x;
            const dy = v.y - y;
            if (dx * dx + dy * dy < radius * radius) {
                return id;
            }
        }
        return null;
    }

    addAgent() {
        const id = this.agents.length;
        this.agents.push(new Agent(id));
        this.selectedAgent = id;
        this.renderAgentsList();
        this.updateRemoveButton();
    }

    removeSelectedAgent() {
        if (this.selectedAgent !== null && this.agents.length > 0) {
            this.agents.splice(this.selectedAgent, 1);
            this.agents.forEach((a, i) => {
                a.id = i;
                a.color = AGENT_COLORS[i % AGENT_COLORS.length];
            });
            this.selectedAgent = this.agents.length > 0 ? 0 : null;
            this.renderAgentsList();
            this.updateRemoveButton();
            this.render();
        }
    }

    selectAgent(id) {
        this.selectedAgent = id;
        this.renderAgentsList();
        this.updateRemoveButton();
    }

    renderAgentsList() {
        const container = document.getElementById('agentsList');
        container.innerHTML = '';

        this.agents.forEach(agent => {
            const div = document.createElement('div');
            div.className = 'agent-item' + (agent.id === this.selectedAgent ? ' selected' : '');
            div.onclick = () => this.selectAgent(agent.id);

            const startLabel = agent.start !== null ? this.graph.getVertexLabel(agent.start) : '?';
            const goalLabel = agent.goal !== null ? this.graph.getVertexLabel(agent.goal) : '?';

            div.innerHTML = `
                <div class="agent-dot" style="background: ${agent.color}"></div>
                <div class="agent-info">
                    <span class="label">Agent ${agent.id + 1}</span>
                    <span class="positions">${startLabel} → ${goalLabel}</span>
                </div>
            `;
            container.appendChild(div);
        });
    }

    updateRemoveButton() {
        document.getElementById('removeAgentBtn').disabled = this.selectedAgent === null;
    }

    updateInstructions() {
        const instructions = document.getElementById('instructions');
        switch (this.mode) {
            case 'edit':
                instructions.textContent = 'Click to add vertex. Drag between vertices to add edge. Hover + Delete to remove vertex.';
                break;
            case 'start':
                instructions.textContent = 'Click a vertex to set the START position for the selected agent.';
                break;
            case 'goal':
                instructions.textContent = 'Click a vertex to set the GOAL position for the selected agent.';
                break;
        }
    }

    initAlgorithm() {
        if (this.graph.vertices.size < 2) {
            alert('Please create a graph with at least 2 vertices.');
            return;
        }
        if (this.agents.length === 0) {
            alert('Please add at least one agent.');
            return;
        }
        for (const agent of this.agents) {
            if (agent.start === null || agent.goal === null) {
                alert(`Please set start and goal for Agent ${agent.id + 1}.`);
                return;
            }
        }

        this.algorithm = new LaCAM(this.graph, this.agents);
        this.algorithm.initialize();

        document.getElementById('resetBtn').disabled = false;
        document.getElementById('backBtn').disabled = false;
        document.getElementById('stepBtn').disabled = false;
        document.getElementById('playBtn').disabled = false;
        document.getElementById('initAlgorithmBtn').disabled = true;

        this.render();
        this.updateUI();
    }

    resetAlgorithm() {
        this.stopPlay();
        if (this.algorithm) {
            this.algorithm.reset();
            document.getElementById('solutionSection').style.display = 'none';
            this.render();
            this.updateUI();
        }
    }

    stepForward() {
        if (this.algorithm && this.algorithm.state.status === 'running') {
            this.algorithm.step();
            this.render();
            this.updateUI();

            if (this.algorithm.state.status !== 'running') {
                this.stopPlay();
            }
        }
    }

    stepBack() {
        if (this.algorithm) {
            this.algorithm.stepBack();
            this.render();
            this.updateUI();
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.stopPlay();
        } else {
            this.startPlay();
        }
    }

    startPlay() {
        this.isPlaying = true;
        document.getElementById('playBtn').textContent = 'Pause';

        const speed = document.getElementById('speedSlider').value;
        const delay = 1100 - speed * 100;

        this.playInterval = setInterval(() => {
            if (this.algorithm && this.algorithm.state.status === 'running') {
                this.stepForward();
            } else {
                this.stopPlay();
            }
        }, delay);
    }

    stopPlay() {
        this.isPlaying = false;
        document.getElementById('playBtn').textContent = 'Play';
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }

    clearGraph() {
        this.stopPlay();
        this.graph.clear();
        this.agents = [];
        this.selectedAgent = null;
        this.algorithm = null;

        document.getElementById('resetBtn').disabled = true;
        document.getElementById('backBtn').disabled = true;
        document.getElementById('stepBtn').disabled = true;
        document.getElementById('playBtn').disabled = true;
        document.getElementById('initAlgorithmBtn').disabled = false;
        document.getElementById('solutionSection').style.display = 'none';

        this.renderAgentsList();
        this.updateRemoveButton();
        this.render();
        this.updateUI();
    }

    loadExample(name) {
        this.clearGraph();

        switch (name) {
            case 'paper':
                const a = this.graph.addVertex(80, 150);
                const b = this.graph.addVertex(200, 150);
                const c = this.graph.addVertex(320, 150);
                const d = this.graph.addVertex(80, 280);
                this.graph.addEdge(a, b);
                this.graph.addEdge(b, c);
                this.graph.addEdge(a, d);
                this.agents.push(new Agent(0, a, d));
                this.agents.push(new Agent(1, c, b));
                break;

            case 'swap':
                const s1 = this.graph.addVertex(100, 175);
                const s2 = this.graph.addVertex(200, 175);
                const s3 = this.graph.addVertex(300, 175);
                this.graph.addEdge(s1, s2);
                this.graph.addEdge(s2, s3);
                this.agents.push(new Agent(0, s1, s3));
                this.agents.push(new Agent(1, s3, s1));
                break;

            case 'tunnel':
                const t1 = this.graph.addVertex(50, 175);
                const t2 = this.graph.addVertex(125, 175);
                const t3 = this.graph.addVertex(200, 175);
                const t4 = this.graph.addVertex(275, 175);
                const t5 = this.graph.addVertex(350, 175);
                const t6 = this.graph.addVertex(200, 100);
                this.graph.addEdge(t1, t2);
                this.graph.addEdge(t2, t3);
                this.graph.addEdge(t3, t4);
                this.graph.addEdge(t4, t5);
                this.graph.addEdge(t3, t6);
                this.agents.push(new Agent(0, t1, t5));
                this.agents.push(new Agent(1, t5, t1));
                break;

            case 'grid':
                const gridV = [];
                for (let row = 0; row < 3; row++) {
                    for (let col = 0; col < 3; col++) {
                        gridV.push(this.graph.addVertex(100 + col * 100, 100 + row * 100));
                    }
                }
                for (let row = 0; row < 3; row++) {
                    for (let col = 0; col < 2; col++) {
                        this.graph.addEdge(gridV[row * 3 + col], gridV[row * 3 + col + 1]);
                    }
                }
                for (let row = 0; row < 2; row++) {
                    for (let col = 0; col < 3; col++) {
                        this.graph.addEdge(gridV[row * 3 + col], gridV[(row + 1) * 3 + col]);
                    }
                }
                this.agents.push(new Agent(0, gridV[0], gridV[8]));
                this.agents.push(new Agent(1, gridV[2], gridV[6]));
                break;
        }

        this.selectedAgent = 0;
        this.renderAgentsList();
        this.updateRemoveButton();
        this.render();
    }

    updateUI() {
        if (!this.algorithm) {
            document.getElementById('stepNumber').textContent = '0';
            document.getElementById('phaseInfo').textContent = '-';
            document.getElementById('statusInfo').textContent = 'Not Started';
            document.getElementById('statusInfo').className = 'status-badge';
            document.getElementById('stepDescription').textContent = 'Create a graph and add agents to begin.';
            document.getElementById('phaseTitle').textContent = 'Getting Started';
            document.getElementById('phaseDetail').textContent = 'The algorithm uses a two-level search: HIGH-LEVEL searches configurations (agent positions), LOW-LEVEL searches constraints (which agent goes where next).';
            document.getElementById('nodesGenerated').textContent = '0';
            document.getElementById('configsExplored').textContent = '0';
            document.getElementById('treeSize').textContent = '0';
            document.getElementById('openStack').innerHTML = '<div class="empty-state">Initialize algorithm to begin</div>';
            document.getElementById('exploredTable').innerHTML = '<div class="empty-state">No configurations explored yet</div>';
            return;
        }

        const state = this.algorithm.state;
        const phaseInfo = this.algorithm.getPhaseExplanation();

        document.getElementById('stepNumber').textContent = state.stepNumber;
        document.getElementById('phaseInfo').textContent = phaseInfo.name;
        document.getElementById('statusInfo').textContent = state.status;
        document.getElementById('statusInfo').className = 'status-badge ' + state.status.replace('_', '-');
        document.getElementById('stepDescription').textContent = state.description;
        document.getElementById('phaseTitle').textContent = phaseInfo.name + ' - ' + phaseInfo.short;
        document.getElementById('phaseDetail').textContent = phaseInfo.detail;
        document.getElementById('nodesGenerated').textContent = state.nodesGenerated;
        document.getElementById('configsExplored').textContent = state.configurationsExplored;
        document.getElementById('treeSize').textContent = this.algorithm.getTreeSize();

        this.renderOpenStack();
        this.renderExploredTable();

        if (state.solution) {
            document.getElementById('solutionSection').style.display = 'block';
            this.renderSolution();
        }

        if (state.status !== 'running') {
            document.getElementById('stepBtn').disabled = true;
            document.getElementById('playBtn').disabled = true;
        }
    }

    renderOpenStack() {
        const container = document.getElementById('openStack');
        const state = this.algorithm.state;

        if (state.open.length === 0) {
            container.innerHTML = '<div class="empty-state">Stack is empty</div>';
            return;
        }

        container.innerHTML = '';
        for (let i = state.open.length - 1; i >= 0; i--) {
            const node = state.open[i];
            const isCurrent = node === state.currentHighLevelNode;

            const div = document.createElement('div');
            div.className = 'stack-item' + (isCurrent ? ' current' : '');
            div.innerHTML = `
                <span class="config">${node.config.toString(this.graph)}</span>
                <span class="node-id">N${node.id}</span>
                ${isCurrent ? '<span class="pointer">◀</span>' : ''}
            `;
            container.appendChild(div);
        }
    }

    renderExploredTable() {
        const container = document.getElementById('exploredTable');
        const state = this.algorithm.state;

        if (state.explored.size === 0) {
            container.innerHTML = '<div class="empty-state">No configurations explored yet</div>';
            return;
        }

        container.innerHTML = '';
        state.explored.forEach((node, hash) => {
            const div = document.createElement('div');
            div.className = 'explored-item';
            div.innerHTML = `
                <span class="config">${node.config.toString(this.graph)}</span>
                <span class="node-ref">→ N${node.id}</span>
            `;
            container.appendChild(div);
        });
    }

    renderSolution() {
        const container = document.getElementById('solutionPath');
        const solution = this.algorithm.state.solution;

        container.innerHTML = '';
        solution.forEach((config, t) => {
            const div = document.createElement('div');
            div.className = 'solution-step';
            div.innerHTML = `<span class="time">t=${t}:</span> ${config.toString(this.graph)}`;
            container.appendChild(div);
        });
    }

    render() {
        this.renderGraph();
        this.renderTree();
        this.renderMiniGraph();
    }

    renderGraph() {
        const ctx = this.graphCtx;
        const width = 400, height = 350;

        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 2;
        this.graph.edges.forEach(edge => {
            const v1 = this.graph.vertices.get(edge.v1);
            const v2 = this.graph.vertices.get(edge.v2);
            ctx.beginPath();
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
            ctx.stroke();
        });

        if (this.dragStart !== null && this.dragEnd !== null) {
            const v1 = this.graph.vertices.get(this.dragStart);
            ctx.strokeStyle = '#ffffff';
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(this.dragEnd.x, this.dragEnd.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        this.graph.vertices.forEach((v, id) => {
            const isHovered = id === this.hoveredVertex;
            const isStart = this.agents.some(a => a.start === id);
            const isGoal = this.agents.some(a => a.goal === id);

            ctx.beginPath();
            ctx.arc(v.x, v.y, isHovered ? 18 : 15, 0, Math.PI * 2);
            ctx.fillStyle = isHovered ? '#ffffff' : '#1a1a1a';
            ctx.fill();
            ctx.strokeStyle = '#444444';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(v.label, v.x, v.y);

            if (isStart || isGoal) {
                ctx.font = '10px sans-serif';
                ctx.fillStyle = '#888888';
                ctx.fillText(isStart && isGoal ? 'S/G' : (isStart ? 'S' : 'G'), v.x, v.y - 25);
            }
        });

        if (this.algorithm && this.algorithm.state.currentHighLevelNode) {
            const config = this.algorithm.state.currentHighLevelNode.config;
            this.agents.forEach(agent => {
                const vertexId = config.get(agent.id);
                const v = this.graph.vertices.get(vertexId);
                if (v) {
                    ctx.beginPath();
                    ctx.arc(v.x, v.y + 25, 10, 0, Math.PI * 2);
                    ctx.fillStyle = agent.color;
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 2;
                    ctx.stroke();

                    ctx.fillStyle = '#000';
                    ctx.font = 'bold 10px sans-serif';
                    ctx.fillText(agent.id + 1, v.x, v.y + 25);
                }
            });
        } else if (this.agents.length > 0) {
            this.agents.forEach(agent => {
                if (agent.start !== null) {
                    const v = this.graph.vertices.get(agent.start);
                    if (v) {
                        ctx.beginPath();
                        ctx.arc(v.x, v.y + 25, 10, 0, Math.PI * 2);
                        ctx.fillStyle = agent.color;
                        ctx.fill();
                        ctx.strokeStyle = '#fff';
                        ctx.lineWidth = 2;
                        ctx.stroke();

                        ctx.fillStyle = '#000';
                        ctx.font = 'bold 10px sans-serif';
                        ctx.fillText(agent.id + 1, v.x, v.y + 25);
                    }
                }
            });
        }
    }

    renderTree() {
        const canvas = document.getElementById('treeCanvas');
        const baseHeight = 200;

        if (!this.algorithm || !this.algorithm.state.currentHighLevelNode) {
            this.treeCtx = this.setupCanvas(canvas, 350, baseHeight);
            this.treeCtx.fillStyle = '#555555';
            this.treeCtx.font = '13px sans-serif';
            this.treeCtx.textAlign = 'center';
            this.treeCtx.fillText('No constraint tree yet', 175, baseHeight / 2);
            return;
        }

        const root = this.algorithm.state.currentHighLevelNode.treeRoot;
        if (!root) return;

        const currentNode = this.algorithm.state.currentLowLevelNode;

        const nodeRadius = 18;
        const minNodeSpacing = 50;
        const levelHeight = 50;
        const startY = 30;
        const padding = 30;

        const subtreeWidths = new Map();
        const calcSubtreeWidth = (node) => {
            if (node.children.length === 0) {
                subtreeWidths.set(node.id, 1);
                return 1;
            }
            let width = 0;
            node.children.forEach(child => {
                width += calcSubtreeWidth(child);
            });
            subtreeWidths.set(node.id, width);
            return width;
        };
        const totalLeaves = calcSubtreeWidth(root);

        const requiredWidth = Math.max(350, totalLeaves * minNodeSpacing + padding * 2);

        this.treeCtx = this.setupCanvas(canvas, requiredWidth, baseHeight);
        const ctx = this.treeCtx;

        const nodePositions = new Map();
        const assignPositions = (node, depth, leftX) => {
            const subtreeWidth = subtreeWidths.get(node.id);
            const nodeWidth = subtreeWidth * minNodeSpacing;
            const x = leftX + nodeWidth / 2;
            const y = startY + depth * levelHeight;
            nodePositions.set(node.id, { x, y, node });

            if (node.children.length > 0) {
                let childLeft = leftX;
                node.children.forEach(child => {
                    const childWidth = subtreeWidths.get(child.id) * minNodeSpacing;
                    assignPositions(child, depth + 1, childLeft);
                    childLeft += childWidth;
                });
            }
        };

        assignPositions(root, 0, padding);

        ctx.clearRect(0, 0, requiredWidth, baseHeight);

        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 2;
        nodePositions.forEach(({ x, y, node }) => {
            node.children.forEach(child => {
                const childPos = nodePositions.get(child.id);
                if (childPos) {
                    ctx.beginPath();
                    ctx.moveTo(x, y + nodeRadius);
                    ctx.lineTo(childPos.x, childPos.y - nodeRadius);
                    ctx.stroke();
                }
            });
        });

        if (currentNode) {
            ctx.strokeStyle = '#64c8ff';
            ctx.lineWidth = 3;
            let node = currentNode;
            while (node && node.parent) {
                const pos = nodePositions.get(node.id);
                const parentPos = nodePositions.get(node.parent.id);
                if (pos && parentPos) {
                    ctx.beginPath();
                    ctx.moveTo(parentPos.x, parentPos.y + nodeRadius);
                    ctx.lineTo(pos.x, pos.y - nodeRadius);
                    ctx.stroke();
                }
                node = node.parent;
            }
        }

        nodePositions.forEach(({ x, y, node }) => {
            const isCurrent = node === currentNode;

            ctx.beginPath();
            ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);

            if (isCurrent) {
                ctx.fillStyle = '#64c8ff';
            } else if (node.isSearched) {
                ctx.fillStyle = '#555555';
            } else {
                ctx.fillStyle = '#1a1a1a';
            }
            ctx.fill();

            ctx.strokeStyle = isCurrent ? '#64c8ff' : (node.isSearched ? '#333333' : '#444444');
            ctx.lineWidth = isCurrent ? 3 : 2;
            ctx.stroke();

            ctx.fillStyle = isCurrent ? '#000' : '#fff';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(node.getLabel(this.graph), x, y);

            if (isCurrent) {
                ctx.fillStyle = '#64c8ff';
                ctx.font = 'bold 12px sans-serif';
                ctx.fillText('◀', x + nodeRadius + 10, y);
            }
        });
    }

    renderMiniGraph() {
        const ctx = this.miniCtx;
        const width = 150, height = 120;

        ctx.clearRect(0, 0, width, height);

        if (this.graph.vertices.size === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.graph.vertices.forEach(v => {
            minX = Math.min(minX, v.x);
            minY = Math.min(minY, v.y);
            maxX = Math.max(maxX, v.x);
            maxY = Math.max(maxY, v.y);
        });

        const padding = 15;
        const scaleX = (width - 2 * padding) / (maxX - minX || 1);
        const scaleY = (height - 2 * padding) / (maxY - minY || 1);
        const scale = Math.min(scaleX, scaleY, 0.5);

        const transform = (v) => ({
            x: padding + (v.x - minX) * scale,
            y: padding + (v.y - minY) * scale
        });

        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        this.graph.edges.forEach(edge => {
            const v1 = transform(this.graph.vertices.get(edge.v1));
            const v2 = transform(this.graph.vertices.get(edge.v2));
            ctx.beginPath();
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
            ctx.stroke();
        });

        this.graph.vertices.forEach((v, id) => {
            const pos = transform(v);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#1a1a1a';
            ctx.fill();
            ctx.strokeStyle = '#444444';
            ctx.stroke();
        });

        if (this.algorithm && this.algorithm.state.currentHighLevelNode) {
            const config = this.algorithm.state.currentHighLevelNode.config;
            this.agents.forEach(agent => {
                const vertexId = config.get(agent.id);
                const v = this.graph.vertices.get(vertexId);
                if (v) {
                    const pos = transform(v);
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
                    ctx.fillStyle = agent.color;
                    ctx.fill();
                }
            });
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
