const fs = require("fs");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const t = require( "@babel/types")
const { generate } = require("@babel/generator");

const code = fs.readFileSync(process.argv[2], "utf-8");
let ast = parser.parse(code);

let arrayName = "";
let arraySupplierName = "";
let arraySupplierCode = ""
let arrayAccessFuncName = "";
let arrayAccessFunc = "";
let arrayRotateCode = undefined;
let arrayVals = [];
let targetHash = -9999;
let offset = 0;
let offsetOperator = undefined;
let paramNames = [];
let arrayAccessAliases = new Set();
const operators = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b 
};

function resolveAccessor(idx) {
    return arrayVals[offsetOperator(idx, offset)]
};

function calc(node) {

    if (t.isNumericLiteral(node)) {
        return node.value;
    }

    if (t.isUnaryExpression(node)) {
        const v = calc(node.argument);

        switch (node.operator) {
            case "-": return -v;
            case "+": return +v;
            default: throw new Error("Unsupported unary op");
        }
    }

    if (t.isBinaryExpression(node)) {
        const l = calc(node.left);
        const r = calc(node.right);

        switch (node.operator) {
            case "+": return l + r;
            case "-": return l - r;
            case "*": return l * r;
            case "/": return l / r;
            default: throw new Error("Unsupported binary op");
        }
    }

    if (t.isCallExpression(node)) {

        if (t.isIdentifier(node.callee, { name: "parseInt" })) {
            const val = calc(node.arguments[0]);
            return parseInt(val)       
            //throw new Error("Unsupported parseInt in call");
        } else { // Assume only calls parseInt or the accessor func.  Maybe be smarter and verify accessor func 
            const idx = calc(node.arguments[0]);
            return resolveAccessor(idx).value;
        }
        
    }

    throw new Error(`Unhandled node type: ${node}`);
};

const FindArraysVisitor = {
    VariableDeclaration(path) {
        path.node.declarations.forEach(declarator => {
            if (t.isArrayExpression(declarator.init)) {                
                this.potentialFunc.arrayNames.push(declarator.id.name);                
                this.potentialFunc.arrayVals.push(declarator.init.elements); 
            }
        });
    }
};

const ValidateSubFuncsVisitor = {
    AssignmentExpression(path) {
        if (t.isIdentifier(path.node.left) && t.isFunctionExpression(path.node.right)) {
            let res = {returnObj: ""};
            path.traverse(ArrayFunctionExpressionVisitor, {res});            
            if (res.returnObj !== "" && this.potentialFunc.arrayNames.includes(res.returnObj)) {                
                this.potentialFunc.subFuncNames.push(path.node.left.name);                
            }
        }
    }
};

const ArrayFunctionExpressionVisitor = {
    FunctionExpression(path) {
        if (path.node.body.body.length == 1 && t.isReturnStatement(path.node.body.body[0])) {
            let stmt = path.node.body.body[0];
            if (t.isIdentifier(stmt.argument)) {                                              
                this.res.returnObj = stmt.argument.name;
            }                 
        }
    }
};

const ValidateReturnVisitor = {
    ReturnStatement(path) {
        if (t.isCallExpression(path.node.argument) && t.isIdentifier(path.node.argument.callee)) {            
            if (this.potentialFunc.subFuncNames.includes(path.node.argument.callee.name)) {
                this.potentialFunc.isMatch = true;
            }            
        }
    }
};

const FindArraySupplierVisitor = {
    FunctionDeclaration(path) {        
        let body = path.node.body.body;        

        let potentialFunc = {
            name: path.node.id.name,
            arrayNames: [],
            arrayVals: [],
            subFuncNames: [],
            isMatch: false
        }

        // Expect variable declaration, expression statement, and return statement
        if (body.length === 3) {                        
            path.traverse(FindArraysVisitor, {potentialFunc})   
            path.traverse(ValidateSubFuncsVisitor, {potentialFunc})
            path.traverse(ValidateReturnVisitor, {potentialFunc})            
            
            if (potentialFunc.isMatch && potentialFunc.arrayNames.length === 1) {
                arraySupplierName = potentialFunc.name;
                arrayName = potentialFunc.arrayNames[0];
                arrayVals = potentialFunc.arrayVals[0];
                //arraySupplierCode = generate(path.node,).code;
                arraySupplierCode = path.node;
            }

        } else {            
            return;
        }        
    },
};

const ValidateRotateFunctionVisitor = {
    CallExpression(path) {
        if (path.node.arguments.length === 2) {            
            for (let i = 0; i < 2; i++) {
                let arg = path.node.arguments[i]
                if (t.isIdentifier(arg) && arg.name === arraySupplierName) {
                    this.state.found = true;
                    this.state.literal = path.node.arguments[(i + 1) % 2].value

                }
            }
        }
    },
};

const FindRotateFunctionVisitor = {
    ExpressionStatement(path) {
        let state = {found: false, literal: -1}
        // TODO: more validations on rotation function like make sure it only contains math & shift & no funny business? 
        path.traverse(ValidateRotateFunctionVisitor, {state})
        if (state.found) {
            //arrayRotateCode = generate(path.node,).code;
            arrayRotateCode = path.node.expression.callee;
            targetHash = state.literal
        }

    },
};

// line 9293 in AST Explorer for accessor code
const FindArrayAccessFunctionVisitor = {
    CallExpression(path) {
        let callee = path.node.callee
        if (t.isIdentifier(callee) && callee.name === arraySupplierName) {
            try {                                                                                
                if (t.isFunctionDeclaration(path.parentPath.parentPath.parentPath.parent)) {                    
                    arrayAccessFuncName = path.parentPath.parentPath.parentPath.parent.id.name;
                    arrayAccessFunc = path.parentPath.parentPath.parentPath.parent;
                }
            } catch (error) {
                // Probably tried to access nonexistent parent. Not the node we want
            }
        }
    },
};

const FindArrayAccessAliasesVisitor = {
    VariableDeclarator(path) {
        if (t.isIdentifier(path.node.init) && path.node.init.name === arrayAccessFuncName) {
            if (t.isIdentifier(path.node.id)) {
                arrayAccessAliases.add(path.node.id.name);                                                                       
            }
        }
    },
};

// Not really needed, just directly replace array access
const RemoveAliasVisitor = {
    CallExpression(path) {
        if (t.isIdentifier(path.node.callee) && arrayAccessAliases.has(path.node.callee.name)) {
            path.node.callee.name = arrayAccessFuncName;
            madeChanges = true;
        }
    },
    VariableDeclarator(path) {
        if (t.isIdentifier(path.node.init) && arrayAccessAliases.has(path.node.init.name)) {
            path.node.init.name = arrayAccessFuncName;
            madeChanges = true;
        }
    },
};

const ReplaceArrayAccessVisitor = {
    CallExpression(path) {
        if (t.isIdentifier(path.node.callee) && path.node.callee.name === arrayAccessFuncName) {
            if (t.isLiteral(path.node.arguments[0])) {
                let index = path.node.arguments[0].value;
                let arrVal = resolveAccessor(index).value;
                path.replaceWith(t.stringLiteral(arrVal)); // Use path.replaceWith here because we are replacing path.node, vs the RemoveAliasVisitor where we are changing a field under path.node
                
            }
        }
    },
};

// https://uoftctf.org/posts/deobfuscating-javascript-via-ast-constant-folding/binary-expression-simplification/
const ConstantFoldVisitor = {
    BinaryExpression(path) {
        let { confident, value } = path.evaluate();
        if (!confident) return;
        let resolved = t.valueToNode(value);
        if (!t.isLiteral(resolved)) return;
        path.replaceWith(resolved);
    },
};

traverse(ast, FindArraySupplierVisitor);
traverse(ast, FindArrayAccessFunctionVisitor)

console.log("Supplier func: " + arraySupplierName + "\nArray: " + arrayName + "\nAccess Function: " + arrayAccessFuncName);
console.log("Array has " + arrayVals.length + " elements");

traverse(ast, FindRotateFunctionVisitor);

arrayAccessFunc.params.forEach(param => {
    paramNames.push(param.name);
});
arrayAccessFunc.body.body.forEach(element => {
    if (t.isExpressionStatement(element) && t.isAssignmentExpression(element.expression) && t.isBinaryExpression(element.expression.right)) {
        let expression = element.expression.right
        if (t.isIdentifier(expression.left) && paramNames.includes(expression.left.name) && t.isLiteral(expression.right)) {
            offsetOperator = operators[expression.operator]
            offset = expression.right.value
        }
    }
});

console.log("Accessor function uses offset value " + offset + " with operation " + offsetOperator);


let hashOperationsNode = undefined;
// Rotate function should have try catch because the math may result in undefined values
//Assume push shift for now?
//console.log(generate(arrayRotateCode.body).code)
arrayRotateCode.body.body.forEach(element => {
    if(t.isWhileStatement(element)) {
        element.body.body.forEach(whileElement => {
            if (t.isTryStatement(whileElement)) {                
                let rotateBlock = whileElement.block;
                rotateBlock.body.forEach(node => {
                    if (t.isVariableDeclaration(node) && node.declarations.length == 1) {
                        hashOperationsNode = node.declarations[0].init;                
                    }
                });
            }            
        });
    }
    
});

if(!hashOperationsNode) {
    console.log("FAILED. Did not identify hash operations.");
    process.exit();
}
//console.log(generate(hashOperationsNode).code)
let hash = 0;
for(let i = 0; i <= arrayVals.length; i++) {    
    hash = calc(hashOperationsNode);    
    if (hash === targetHash) {
        console.log("Successfully rotated array");
        break;
    }
    //console.log(hash + " != " + targetHash);

    arrayVals.push(arrayVals.shift())
}

let madeChanges = false;
traverse(ast, FindArrayAccessAliasesVisitor);
traverse(ast, RemoveAliasVisitor);
while (madeChanges) {
    madeChanges = false
    traverse(ast, FindArrayAccessAliasesVisitor);
    traverse(ast, RemoveAliasVisitor);
}
traverse(ast, ReplaceArrayAccessVisitor);
traverse(ast, ConstantFoldVisitor);

console.log("Aliases: " + arrayAccessAliases)

let deobfuscated = generate(ast).code;

let outfile = process.argv[2] + "_deobfuscated"
fs.writeFile(outfile, deobfuscated, err => {
    if (err) {
        console.error(err);
    } else {
        console.log("Deobfuscated code saved as " + outfile)
    }
});
