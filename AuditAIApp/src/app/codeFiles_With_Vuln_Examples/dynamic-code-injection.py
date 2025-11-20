from flask import request # type: ignore

@app.route("/") # type: ignore
def example():
    operation = request.args.get("operation")
    eval(f"product_{operation}()") # Noncompliant
    return "OK"