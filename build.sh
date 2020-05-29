#!/bin/bash

echo "Building from file src/$@.mm..."
${HOME}/node_modules/.bin/mmdc -i "mermaid/$@.mm" -o "mermaid/dist/$@.pdf" -t forest -C mermaid/assets/flowchart.css && open "mermaid/dist/$@.pdf"
echo "Created dist/$@.pdf"