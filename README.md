# Planova – Intelligent Demand, Inventory & Supply Planning System

## Project Overview
Planova is an intelligent demand, inventory and supply planning prototype designed to help businesses identify potential stock shortages, analyse supplier constraints and explore possible mitigation strategies.

## Objectives
- Analyse forecast demand and available inventory.
- Identify and prioritise potential stock shortages.
- Consider supplier lead times and capacity.
- Generate mitigation recommendations.
- Validate planning data and identify common supply-chain issues.

## Key Features
- SKU, location and supplier data management.
- Weekly demand and inventory planning.
- Purchase order and lead-time analysis.
- Shortage identification and explanations.
- Supplier capacity analysis.
- Mitigation feasibility analysis.
- Edge-case testing and validation reports.

## Technologies Used
- Python
- Pandas
- NumPy
- Google Colab
- CSV datasets

## Project Structure
- `data/` – Input datasets, planning results and validation outputs.
- `reports/` – Project summary, schema relationships and reproducibility documentation.
- `Planova.ipynb` – Main development notebook.

## How to Run
1. Download the project ZIP.
2. Extract the files.
3. Open Google Colab.
4. Upload the `Planova.ipynb` notebook.
5. Run the notebook cells in order.

## Dataset
The project currently includes sample SKU, location, supplier, inventory, demand, purchase order and planning datasets. The generator uses a fixed random seed for reproducibility.

## Validation
The project includes validation reports for ID uniqueness, foreign-key consistency, inventory reconciliation, shortage calculations, mitigation references and controlled edge cases.

## Future Improvements
- Expand the dataset to the full assignment scale.
- Strengthen production and supplier capacity constraints.
- Improve mitigation optimisation.
- Develop an interactive planning dashboard.

---
**Project:** Planova  
**Author:** Rachana Budihal  
**Repository:** Planova-AI
