#!/usr/bin/env python3
import json
import sys
import time

for line in sys.stdin:
    request=json.loads(line)
    op=request["op"]
    if op == "hang":
        continue
    if op == "delayed":
        time.sleep(float(request.get("params",{}).get("seconds",0.1)))
    print(json.dumps({"id":request["id"],"ok":True,"result":{"operation":op}}),flush=True)
